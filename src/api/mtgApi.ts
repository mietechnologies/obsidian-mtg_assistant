import { requestUrl, RequestUrlResponse } from "obsidian";

const SCRYFALL_MIN_REQUEST_INTERVAL_MS = 250;
const SCRYFALL_RATE_LIMIT_COOLDOWN_MS = 5000;
let scryfallQueue: Promise<void> = Promise.resolve();
let lastScryfallRequestAt = 0;
let scryfallBlockedUntil = 0;

export type CardLookupStatus =
	| "success"
	| "not-found"
	| "no-image"
	| "rate-limited"
	| "network-error";

export interface CardMetadataFields {
	manaCost?: string;
	manaCosts?: string[];
	manaValue?: number;
	oracleText?: string;
	oracleTexts?: string[];
	typeLine?: string;
	power?: string;
	toughness?: string;
	colors?: string[];
	colorIdentity?: string[];
	keywords?: string[];
	legalities?: Record<string, string>;
	rarity?: string;
	prices?: {
		usd?: string | null;
		usdFoil?: string | null;
		usdEtched?: string | null;
		eur?: string | null;
		eurFoil?: string | null;
		tix?: string | null;
	};
}

export interface CardResult {
	status: CardLookupStatus;
	name?: string;
	imageUrl?: string;
	message?: string;
	metadata?: CardMetadataFields;
}

interface ScryfallCard {
	object: string;
	name: string;
	mana_cost?: string;
	cmc?: number;
	oracle_text?: string;
	type_line?: string;
	power?: string;
	toughness?: string;
	colors?: string[];
	color_identity?: string[];
	keywords?: string[];
	legalities?: Record<string, string>;
	rarity?: string;
	prices?: {
		usd?: string | null;
		usd_foil?: string | null;
		usd_etched?: string | null;
		eur?: string | null;
		eur_foil?: string | null;
		tix?: string | null;
	};
	image_uris?: { normal: string };
	card_faces?: Array<{ mana_cost?: string; oracle_text?: string; image_uris?: { normal: string } }>;
	details?: string;
}

interface ScryfallCollectionResponse {
	object: string;
	data?: ScryfallCard[];
	not_found?: Array<{ name?: string }>;
	details?: string;
}

function extractImageUrl(data: ScryfallCard): string | undefined {
	return data.image_uris?.normal ?? data.card_faces?.[0]?.image_uris?.normal;
}

function buildErrorResult(response: RequestUrlResponse): CardResult {
	if (response.status === 404) {
		return { status: "not-found", message: "Card not found on Scryfall." };
	}

	if (response.status === 429 || response.status === 403) {
		scryfallBlockedUntil = Math.max(
			scryfallBlockedUntil,
			Date.now() + SCRYFALL_RATE_LIMIT_COOLDOWN_MS
		);
		return {
			status: "rate-limited",
			message: "Scryfall rate limited or blocked the request. The plugin will pause lookups briefly before trying again.",
		};
	}

	return {
		status: "network-error",
		message: `Lookup failed with status ${response.status}.`,
	};
}

function getRequestHeaders(): Record<string, string> {
	return {
		Accept: "application/json;q=0.9,*/*;q=0.8",
		"User-Agent": "MTG Assistant/1.0 (Obsidian plugin)",
	};
}

async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function scheduleScryfallRequest<T>(task: () => Promise<T>): Promise<T> {
	const previous = scryfallQueue;
	let releaseQueue!: () => void;
	scryfallQueue = new Promise<void>((resolve) => {
		releaseQueue = resolve;
	});

	await previous;

	try {
		const elapsed = Date.now() - lastScryfallRequestAt;
		if (elapsed < SCRYFALL_MIN_REQUEST_INTERVAL_MS) {
			await delay(SCRYFALL_MIN_REQUEST_INTERVAL_MS - elapsed);
		}

		const cooldownRemaining = scryfallBlockedUntil - Date.now();
		if (cooldownRemaining > 0) {
			await delay(cooldownRemaining);
		}

		lastScryfallRequestAt = Date.now();
		return await task();
	} finally {
		releaseQueue();
	}
}

function extractMetadata(data: ScryfallCard): CardMetadataFields {
	const manaCosts = data.card_faces
		?.map((face) => face.mana_cost?.trim() ?? "")
		.filter((cost) => cost.length > 0);
	const oracleTexts = data.card_faces
		?.map((face) => face.oracle_text?.trim() ?? "")
		.filter((text) => text.length > 0);

	return {
		manaCost: data.mana_cost,
		manaCosts:
			manaCosts && manaCosts.length > 0
				? manaCosts
				: data.mana_cost
					? [data.mana_cost]
					: undefined,
		manaValue: data.cmc,
		oracleText: data.oracle_text,
		oracleTexts:
			oracleTexts && oracleTexts.length > 0
				? oracleTexts
				: data.oracle_text
					? [data.oracle_text]
					: undefined,
		typeLine: data.type_line,
		power: data.power,
		toughness: data.toughness,
		colors: data.colors,
		colorIdentity: data.color_identity,
		keywords: data.keywords,
		legalities: data.legalities,
		rarity: data.rarity,
		prices: data.prices
			? {
					usd: data.prices.usd,
					usdFoil: data.prices.usd_foil,
					usdEtched: data.prices.usd_etched,
					eur: data.prices.eur,
					eurFoil: data.prices.eur_foil,
					tix: data.prices.tix,
				}
			: undefined,
	};
}

// Fetches a single card from Scryfall using fuzzy name matching and returns
// a structured result so the UI can distinguish not-found from transient failures.
export async function fetchCard(name: string): Promise<CardResult> {
	const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;

	try {
		const request = () =>
			scheduleScryfallRequest(() =>
				requestUrl({
					url,
					throw: false,
					headers: getRequestHeaders(),
				})
			);

		let response = await request();
		if (response.status === 429 || response.status === 403) {
			buildErrorResult(response);
			response = await request();
		}

		if (response.status >= 400) {
			return buildErrorResult(response);
		}

		const data = response.json as ScryfallCard;
		if (data.object === "error") {
			if (response.status === 404) {
				return { status: "not-found", message: data.details ?? "Card not found." };
			}

			return {
				status: "network-error",
				message: data.details ?? "Lookup failed.",
			};
		}

		const imageUrl = extractImageUrl(data);
		if (!imageUrl) {
			return {
				status: "no-image",
				name: data.name,
				message: "Card has no preview image available.",
				metadata: extractMetadata(data),
			};
		}

		return {
			status: "success",
			name: data.name,
			imageUrl,
			metadata: extractMetadata(data),
		};
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown network error.";
		return {
			status: "network-error",
			message: `Network error while contacting Scryfall: ${message}`,
		};
	}
}

export async function fetchCardsByNames(names: string[]): Promise<Map<string, CardResult>> {
	const results = new Map<string, CardResult>();
	if (names.length === 0) {
		return results;
	}
	const requestedNamesByKey = new Map(
		names.map((name) => [name.trim().toLowerCase(), name] as const)
	);

	const request = () =>
		scheduleScryfallRequest(() =>
			requestUrl({
				url: "https://api.scryfall.com/cards/collection",
				method: "POST",
				throw: false,
				headers: {
					...getRequestHeaders(),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					identifiers: names.map((name) => ({ name })),
				}),
			})
		);

	try {
		let response = await request();
		if (response.status === 429 || response.status === 403) {
			buildErrorResult(response);
			response = await request();
		}

		if (response.status >= 400) {
			const error = buildErrorResult(response);
			for (const name of names) {
				results.set(name, error);
			}
			return results;
		}

		const payload = response.json as ScryfallCollectionResponse;
		if (payload.object === "error") {
			const error: CardResult = {
				status: "network-error",
				message: payload.details ?? "Lookup failed.",
			};
			for (const name of names) {
				results.set(name, error);
			}
			return results;
		}

		for (const card of payload.data ?? []) {
			const requestedName = requestedNamesByKey.get(card.name.trim().toLowerCase()) ?? card.name;
			const imageUrl = extractImageUrl(card);
			if (!imageUrl) {
				results.set(requestedName, {
					status: "no-image",
					name: card.name,
					message: "Card has no preview image available.",
					metadata: extractMetadata(card),
				});
				continue;
			}

			results.set(requestedName, {
				status: "success",
				name: card.name,
				imageUrl,
				metadata: extractMetadata(card),
			});
		}

		for (const missing of payload.not_found ?? []) {
			if (!missing.name) {
				continue;
			}
			const requestedName =
				requestedNamesByKey.get(missing.name.trim().toLowerCase()) ?? missing.name;
			results.set(requestedName, {
				status: "not-found",
				message: "Card not found on Scryfall.",
			});
		}

		for (const name of names) {
			if (!results.has(name)) {
				results.set(name, {
					status: "not-found",
					message: "Card not found on Scryfall.",
				});
			}
		}

		return results;
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown network error.";
		for (const name of names) {
			results.set(name, {
				status: "network-error",
				message: `Network error while contacting Scryfall: ${message}`,
			});
		}
		return results;
	}
}
