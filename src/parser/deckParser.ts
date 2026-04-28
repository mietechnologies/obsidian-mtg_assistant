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

function parseSectionLabel(line: string, commanderMarker?: string): string | null {
	if (commanderMarker && line.localeCompare(commanderMarker, undefined, { sensitivity: "accent" }) === 0) {
		return "Commander";
	}

	const match = /^\s*-\s*(.+?)\s*:\s*$/.exec(line);
	return match?.[1]?.trim() ?? null;
}

function parseCardLine(line: string): ParsedDeckCard | null {
	for (const pattern of CARD_LINE_PATTERNS) {
		const match = pattern.exec(line);
		if (!match) continue;

		const quantity = Number.parseInt(match[1] ?? "", 10);
		const cardName = match[2]?.trim() ?? "";
		if (!Number.isFinite(quantity) || quantity <= 0 || !cardName) {
			return null;
		}

		return { quantity, cardName };
	}

	return null;
}

export function parseDeckList(source: string, commanderMarker?: string): ParsedDeck {
	const cards = new Map<string, ParsedDeckCard>();
	let currentSection: string | undefined;

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const section = parseSectionLabel(line, commanderMarker?.trim());
		if (section) {
			currentSection = section;
			continue;
		}

		const parsedCard = parseCardLine(line);
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
