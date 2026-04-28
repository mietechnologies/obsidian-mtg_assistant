export interface ParsedDeckCard {
	quantity: number;
	cardName: string;
	section?: string;
}

export interface ParsedDeck {
	cards: ParsedDeckCard[];
}

const CARD_LINE_PATTERNS = [
	/^(\d+)\s*[xX]\s+(.+?)\s*$/,
	/^(\d+)[xX]\s*(.+?)\s*$/,
	/^(\d+)\s+(.+?)\s*$/,
];

function stripListMarker(line: string): string {
	return line.replace(/^[-*+]\s+/, "");
}

function normalizeParsedCardName(cardName: string): string {
	const trimmed = cardName.trim();

	const wikiLinkMatch = /^\[\[([^|\]]+)(?:\|[^\]]+)?\]\]$/.exec(trimmed);
	if (wikiLinkMatch?.[1]) {
		return wikiLinkMatch[1].trim();
	}

	const markdownLinkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(trimmed);
	if (markdownLinkMatch?.[1]) {
		return markdownLinkMatch[1].trim();
	}

	const bracketMatch = /^\[([^\]]+)\]$/.exec(trimmed);
	if (bracketMatch?.[1]) {
		return bracketMatch[1].trim();
	}

	return trimmed;
}

function parseSectionLabel(line: string, commanderMarker?: string): string | null {
	if (commanderMarker && line.localeCompare(commanderMarker, undefined, { sensitivity: "accent" }) === 0) {
		return "Commander";
	}

	const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
	if (headingMatch?.[1]) {
		return headingMatch[1].trim().replace(/:\s*$/, "");
	}

	const match = /^\s*-\s*(.+?)\s*:\s*$/.exec(line);
	return match?.[1]?.trim() ?? null;
}

function parseCardLine(line: string, minimumQuantity: number): ParsedDeckCard | null {
	const normalizedLine = stripListMarker(line);

	for (const pattern of CARD_LINE_PATTERNS) {
		const match = pattern.exec(normalizedLine);
		if (!match) continue;

		const quantity = Number.parseInt(match[1] ?? "", 10);
		const cardName = normalizeParsedCardName(match[2] ?? "");
		if (!Number.isFinite(quantity) || quantity < minimumQuantity || !cardName) {
			return null;
		}

		return { quantity, cardName };
	}

	return null;
}

function parseCardList(
	source: string,
	options: {
		commanderMarker?: string;
		minimumQuantity: number;
	}
): ParsedDeck {
	const cards = new Map<string, ParsedDeckCard>();
	let currentSection: string | undefined;

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const section = parseSectionLabel(line, options.commanderMarker?.trim());
		if (section) {
			currentSection = section;
			continue;
		}

		const parsedCard = parseCardLine(line, options.minimumQuantity);
		if (!parsedCard) continue;

		const key = parsedCard.cardName.toLowerCase();
		const existing = cards.get(key);
		if (existing) {
			existing.quantity += parsedCard.quantity;
			if (!existing.section && currentSection) {
				existing.section = currentSection;
			}
			continue;
		}

		cards.set(key, {
			...parsedCard,
			section: currentSection,
		});
	}

	return { cards: Array.from(cards.values()) };
}

export function parseDeckList(source: string, commanderMarker?: string): ParsedDeck {
	return parseCardList(source, {
		commanderMarker,
		minimumQuantity: 1,
	});
}

export function parseCollectionList(source: string): ParsedDeck {
	return parseCardList(source, {
		minimumQuantity: 0,
	});
}
