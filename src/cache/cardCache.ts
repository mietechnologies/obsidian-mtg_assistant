import { App, requestUrl, RequestUrlResponse } from "obsidian";
import { CardLookupStatus, CardMetadataFields, fetchCard } from "../api/mtgApi";
import { MTGSettings } from "../settings";

interface MetadataEntry {
	timestamp: number;
	staticTimestamp?: number;
	priceTimestamp?: number;
	status: CardLookupStatus | "download-error";
	imageUrl?: string;
	resolvedName?: string;
	message?: string;
	card?: CardMetadataFields;
}

interface MemoryCacheEntry {
	status: CardLookupStatus | "download-error";
	imageSrc?: string;
	resolvedName?: string;
	message?: string;
	card?: CardMetadataFields;
}

export interface CardPreviewResult {
	status: CardLookupStatus | "download-error";
	cardName: string;
	imageSrc?: string;
	message?: string;
	card?: CardMetadataFields;
}

// Manages in-memory and on-disk card image caching.
// In-memory: keyed by normalized card name, stores both successes and failures.
// On-disk: image files + a metadata.json tracking TTL and lookup results.
export class CardCache {
	private memoryCache = new Map<string, MemoryCacheEntry>();
	private metadata = new Map<string, MetadataEntry>();
	private blobUrls = new Set<string>();
	private inflightLookups = new Map<string, Promise<CardPreviewResult>>();

	private readonly cacheDir: string;
	private readonly imagesDir: string;
	private readonly metadataPath: string;

	constructor(
		private readonly app: App,
		pluginId: string,
		private readonly getSettings: () => MTGSettings
	) {
		this.cacheDir = `.obsidian/plugins/${pluginId}/cache`;
		this.imagesDir = `${this.cacheDir}/images`;
		this.metadataPath = `${this.cacheDir}/metadata.json`;
	}

	async init(): Promise<void> {
		await this.ensureDirectories();
		await this.loadMetadata();
	}

	async resolveCard(cardName: string): Promise<CardPreviewResult> {
		const key = this.normalizeKey(cardName);
		const inflight = this.inflightLookups.get(key);
		if (inflight) {
			return inflight;
		}

		const lookupPromise = this.resolveCardInternal(cardName, key);
		this.inflightLookups.set(key, lookupPromise);

		try {
			return await lookupPromise;
		} finally {
			this.inflightLookups.delete(key);
		}
	}

	private async resolveCardInternal(cardName: string, key: string): Promise<CardPreviewResult> {
		const settings = this.getSettings();
		const meta = this.metadata.get(key);
		const staticTtlMs = settings.staticCacheTTLDays * 24 * 60 * 60 * 1000;
		const priceTtlMs = settings.priceCacheHours * 60 * 60 * 1000;

		if (meta && this.isFresh(this.getStaticTimestamp(meta), staticTtlMs)) {
			const cachedEntry = await this.resolveFromMetadata(key, meta);
			if (cachedEntry) {
				if (!this.isPriceRefreshNeeded(meta, priceTtlMs) || meta.status !== "success") {
					return this.toPreviewResult(cardName, cachedEntry);
				}

				const refreshed = await fetchCard(cardName);
				if (refreshed.status === "success" && refreshed.imageUrl) {
					const mergedEntry: MemoryCacheEntry = {
						...cachedEntry,
						status: "success",
						resolvedName: refreshed.name,
						card: refreshed.metadata,
						message: undefined,
					};
					this.memoryCache.set(key, mergedEntry);
					await this.setMetadata(key, {
						...meta,
						status: "success",
						imageUrl: refreshed.imageUrl,
						resolvedName: refreshed.name,
						card: refreshed.metadata,
						priceTimestamp: Date.now(),
					});
					return this.toPreviewResult(cardName, mergedEntry);
				}

				return this.toPreviewResult(cardName, cachedEntry);
			}
		}

		const fetched = await fetchCard(cardName);
		const now = Date.now();
		if (fetched.status !== "success" || !fetched.imageUrl) {
			const entry: MemoryCacheEntry = {
				status: fetched.status,
				resolvedName: fetched.name,
				message: fetched.message,
				card: fetched.metadata,
			};
			this.memoryCache.set(key, entry);
			await this.setMetadata(key, {
				timestamp: now,
				staticTimestamp: now,
				priceTimestamp: now,
				status: fetched.status,
				imageUrl: fetched.imageUrl,
				resolvedName: fetched.name,
				message: fetched.message,
				card: fetched.metadata,
			});
			return this.toPreviewResult(cardName, entry);
		}

		const imagePath = this.getImagePath(key);
		let imageSrc: string;
		if (await this.app.vault.adapter.exists(imagePath)) {
			imageSrc = await this.readAsBlobUrl(imagePath);
		} else {
			const download = await this.downloadImage(fetched.imageUrl, imagePath);
			if (!download.ok) {
			const entry: MemoryCacheEntry = {
				status: "download-error",
				resolvedName: fetched.name,
				message: download.message,
			};
			this.memoryCache.set(key, entry);
			return this.toPreviewResult(cardName, entry);
		}

			imageSrc = await this.readAsBlobUrl(imagePath, download.contentType);
		}
		const entry: MemoryCacheEntry = {
			status: "success",
			imageSrc,
			resolvedName: fetched.name,
			card: fetched.metadata,
		};
		this.memoryCache.set(key, entry);
		await this.setMetadata(key, {
			timestamp: now,
			staticTimestamp: now,
			priceTimestamp: now,
			status: "success",
			imageUrl: fetched.imageUrl,
			resolvedName: fetched.name,
			card: fetched.metadata,
		});

		return this.toPreviewResult(cardName, entry);
	}

	async clearMetadataCache(): Promise<void> {
		this.clearMemoryCache();
		this.metadata.clear();
		if (await this.app.vault.adapter.exists(this.metadataPath)) {
			await this.app.vault.adapter.remove(this.metadataPath);
		}
	}

	async clearImageCache(): Promise<void> {
		this.clearMemoryCache();

		if (await this.app.vault.adapter.exists(this.imagesDir)) {
			const listing = await this.app.vault.adapter.list(this.imagesDir);
			for (const file of listing.files) {
				await this.app.vault.adapter.remove(file);
			}
		}
	}

	async evictCardLookup(cardName: string): Promise<void> {
		const key = this.normalizeKey(cardName);
		this.memoryCache.delete(key);
		this.inflightLookups.delete(key);
		if (!this.metadata.delete(key)) {
			return;
		}

		const serialized = Object.fromEntries(this.metadata.entries());
		await this.app.vault.adapter.write(this.metadataPath, JSON.stringify(serialized, null, 2));
	}

	destroy(): void {
		this.clearMemoryCache();
	}

	private toPreviewResult(cardName: string, entry: MemoryCacheEntry): CardPreviewResult {
		return {
			status: entry.status,
			cardName: entry.resolvedName ?? cardName,
			imageSrc: entry.imageSrc,
			message: entry.message ?? this.getDefaultMessage(entry.status, entry.resolvedName ?? cardName),
			card: entry.card,
		};
	}

	private async resolveFromMetadata(key: string, meta: MetadataEntry): Promise<MemoryCacheEntry | null> {
		const cached = this.memoryCache.get(key);
		if (cached) {
			return cached;
		}

		if (meta.status !== "success") {
			const entry: MemoryCacheEntry = {
				status: meta.status,
				resolvedName: meta.resolvedName,
				message: meta.message,
				card: meta.card,
			};
			this.memoryCache.set(key, entry);
			return entry;
		}

		const imagePath = this.getImagePath(key);
		if (!await this.app.vault.adapter.exists(imagePath)) {
			return null;
		}

		const imageSrc = await this.readAsBlobUrl(imagePath);
		const entry: MemoryCacheEntry = {
			status: "success",
			imageSrc,
			resolvedName: meta.resolvedName,
			card: meta.card,
		};
		this.memoryCache.set(key, entry);
		return entry;
	}

	private normalizeKey(name: string): string {
		return name.trim().toLowerCase();
	}

	private getImagePath(key: string): string {
		const encodedKey = encodeURIComponent(key).replace(/%/g, "_");
		return `${this.imagesDir}/${encodedKey}.img`;
	}

	private async ensureDirectories(): Promise<void> {
		if (!await this.app.vault.adapter.exists(this.cacheDir)) {
			await this.app.vault.adapter.mkdir(this.cacheDir);
		}
		if (!await this.app.vault.adapter.exists(this.imagesDir)) {
			await this.app.vault.adapter.mkdir(this.imagesDir);
		}
	}

	private async loadMetadata(): Promise<void> {
		if (!await this.app.vault.adapter.exists(this.metadataPath)) return;

		try {
			const raw = await this.app.vault.adapter.read(this.metadataPath);
			const parsed = JSON.parse(raw) as Record<string, MetadataEntry & { found?: boolean }>;
			for (const [key, value] of Object.entries(parsed)) {
				if (!value) continue;

				if ("status" in value && value.status) {
					const timestamp = value.staticTimestamp ?? value.timestamp;
					this.metadata.set(key, value);
					if (!value.staticTimestamp && timestamp) {
						value.staticTimestamp = timestamp;
					}
					if (!value.priceTimestamp && timestamp) {
						value.priceTimestamp = timestamp;
					}
					continue;
				}

				if (value.found === false) {
					this.metadata.set(key, {
						timestamp: value.timestamp,
						staticTimestamp: value.timestamp,
						priceTimestamp: value.timestamp,
						status: "not-found",
						message: "Card not found in cached legacy metadata.",
					});
				}
			}
		} catch {
			// Ignore invalid cache metadata and rebuild it lazily.
		}
	}

	private async setMetadata(key: string, entry: MetadataEntry): Promise<void> {
		this.metadata.set(key, entry);
		const serialized = Object.fromEntries(this.metadata.entries());
		await this.app.vault.adapter.write(this.metadataPath, JSON.stringify(serialized, null, 2));
	}

	private async downloadImage(
		url: string,
		path: string
	): Promise<{ ok: true; contentType?: string } | { ok: false; message: string }> {
		try {
			const response = await requestUrl({
				url,
				throw: false,
				headers: {
					Accept: "image/*",
					"User-Agent": "MTG Assistant/1.0 (Obsidian plugin)",
				},
			});
			if (response.status >= 400) {
				return { ok: false, message: this.getDownloadErrorMessage(response) };
			}

			await this.app.vault.adapter.writeBinary(path, response.arrayBuffer);
			return { ok: true, contentType: response.headers["content-type"] };
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown network error.";
			return {
				ok: false,
				message: `Network error while downloading the card image: ${message}`,
			};
		}
	}

	private getDownloadErrorMessage(response: RequestUrlResponse): string {
		if (response.status === 429 || response.status === 403) {
			return "Image download was rate limited or blocked.";
		}

		return `Image download failed with status ${response.status}.`;
	}

	private async readAsBlobUrl(path: string, contentType?: string): Promise<string> {
		const data = await this.app.vault.adapter.readBinary(path);
		const blob = new Blob([data], { type: contentType ?? "image/jpeg" });
		const url = URL.createObjectURL(blob);
		this.blobUrls.add(url);
		return url;
	}

	private clearMemoryCache(): void {
		this.memoryCache.clear();
		this.inflightLookups.clear();
		for (const url of this.blobUrls) {
			URL.revokeObjectURL(url);
		}
		this.blobUrls.clear();
	}

	private getStaticTimestamp(meta: MetadataEntry): number | undefined {
		return meta.staticTimestamp ?? meta.timestamp;
	}

	private getPriceTimestamp(meta: MetadataEntry): number | undefined {
		return meta.priceTimestamp ?? meta.staticTimestamp ?? meta.timestamp;
	}

	private isFresh(timestamp: number | undefined, ttlMs: number): boolean {
		return timestamp !== undefined && Date.now() - timestamp < ttlMs;
	}

	private isPriceRefreshNeeded(meta: MetadataEntry, ttlMs: number): boolean {
		return !this.isFresh(this.getPriceTimestamp(meta), ttlMs);
	}

	private getDefaultMessage(
		status: CardLookupStatus | "download-error",
		cardName: string
	): string | undefined {
		switch (status) {
			case "not-found":
				return `No Scryfall card matched "${cardName}".`;
			case "no-image":
				return `No card image is available for "${cardName}".`;
			case "rate-limited":
				return "Scryfall temporarily rejected the request. Try again later.";
			case "network-error":
				return "Unable to reach Scryfall right now.";
			case "download-error":
				return "The card was found, but the preview image could not be cached locally.";
			case "success":
				return undefined;
		}
	}
}
