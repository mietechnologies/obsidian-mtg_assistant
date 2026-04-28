import { requestUrl, RequestUrlResponse } from "obsidian";

export type CardLookupStatus =
	| "success"
	| "not-found"
	| "no-image"
	| "rate-limited"
	| "network-error";

export interface CardMetadataFields {
	manaCost?: string;
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
	card_faces?: Array<{ image_uris?: { normal: string } }>;
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
		return {
			status: "rate-limited",
			message: "Scryfall rate limited or blocked the request. Try again later.",
		};
	}

	return {
		status: "network-error",
		message: `Lookup failed with status ${response.status}.`,
	};
}

function getRequestHeaders(): Record<string, string> {
	return {
		Accept: "application/json",
		"User-Agent": "MTG Assistant/1.0 (Obsidian plugin)",
	};
}

function extractMetadata(data: ScryfallCard): CardMetadataFields {
	return {
		manaCost: data.mana_cost,
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
		const response = await requestUrl({
			url,
			throw: false,
			headers: getRequestHeaders(),
		});
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
