import { App, requestUrl, RequestUrlResponse } from "obsidian";
import { CardLookupStatus, fetchCard } from "../api/mtgApi";
import { MTGSettings } from "../settings";

interface MetadataEntry {
	timestamp: number;
	status: CardLookupStatus | "download-error";
	imageUrl?: string;
	resolvedName?: string;
	message?: string;
}

interface MemoryCacheEntry {
	status: CardLookupStatus | "download-error";
	imageSrc?: string;
	resolvedName?: string;
	message?: string;
}

export interface CardPreviewResult {
	status: CardLookupStatus | "download-error";
	cardName: string;
	imageSrc?: string;
	message?: string;
}

// Manages in-memory and on-disk card image caching.
// In-memory: keyed by normalized card name, stores both successes and failures.
// On-disk: image files + a metadata.json tracking TTL and lookup results.
export class CardCache {
	private memoryCache = new Map<string, MemoryCacheEntry>();
	private metadata = new Map<string, MetadataEntry>();
	private blobUrls = new Set<string>();

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
		const cached = this.memoryCache.get(key);
		if (cached) {
			return this.toPreviewResult(cardName, cached);
		}

		const settings = this.getSettings();
		const ttlMs = settings.cacheTTLDays * 24 * 60 * 60 * 1000;
		const meta = this.metadata.get(key);

		if (meta && Date.now() - meta.timestamp < ttlMs) {
			const fromMetadata = await this.resolveFromMetadata(cardName, key, meta);
			if (fromMetadata) {
				return fromMetadata;
			}
		}

		const fetched = await fetchCard(cardName);
		if (fetched.status !== "success" || !fetched.imageUrl) {
			const entry: MemoryCacheEntry = {
				status: fetched.status,
				resolvedName: fetched.name,
				message: fetched.message,
			};
			this.memoryCache.set(key, entry);
			await this.setMetadata(key, {
				timestamp: Date.now(),
				status: fetched.status,
				imageUrl: fetched.imageUrl,
				resolvedName: fetched.name,
				message: fetched.message,
			});
			return this.toPreviewResult(cardName, entry);
		}

		const imagePath = this.getImagePath(key);
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

		const imageSrc = await this.readAsBlobUrl(imagePath, download.contentType);
		const entry: MemoryCacheEntry = {
			status: "success",
			imageSrc,
			resolvedName: fetched.name,
		};
		this.memoryCache.set(key, entry);
		await this.setMetadata(key, {
			timestamp: Date.now(),
			status: "success",
			imageUrl: fetched.imageUrl,
			resolvedName: fetched.name,
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

	destroy(): void {
		this.clearMemoryCache();
	}

	private toPreviewResult(cardName: string, entry: MemoryCacheEntry): CardPreviewResult {
		return {
			status: entry.status,
			cardName: entry.resolvedName ?? cardName,
			imageSrc: entry.imageSrc,
			message: entry.message ?? this.getDefaultMessage(entry.status, entry.resolvedName ?? cardName),
		};
	}

	private async resolveFromMetadata(
		cardName: string,
		key: string,
		meta: MetadataEntry
	): Promise<CardPreviewResult | null> {
		if (meta.status !== "success") {
			const entry: MemoryCacheEntry = {
				status: meta.status,
				resolvedName: meta.resolvedName,
				message: meta.message,
			};
			this.memoryCache.set(key, entry);
			return this.toPreviewResult(cardName, entry);
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
		};
		this.memoryCache.set(key, entry);
		return this.toPreviewResult(cardName, entry);
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
					this.metadata.set(key, value);
					continue;
				}

				if (value.found === false) {
					this.metadata.set(key, {
						timestamp: value.timestamp,
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
		for (const url of this.blobUrls) {
			URL.revokeObjectURL(url);
		}
		this.blobUrls.clear();
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
