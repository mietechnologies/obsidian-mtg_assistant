export interface ParsedDeckCard {
	quantity: number;
	cardName: string;
	section?: string;
	have?: number;
}

export interface ParsedDeck {
	cards: ParsedDeckCard[];
	format?: string;
}

interface ParsedSectionLabel {
	name: string;
	isCommander: boolean;
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

function parseHaveMetadata(cardName: string): { cardName: string; have?: number } {
	const match = /(?:\s+\|\s*have\s+|\s+\[have:\s*)(\d+)\s*\]?\s*$/i.exec(cardName);
	if (!match?.[1]) {
		return { cardName };
	}

	const have = Number.parseInt(match[1], 10);
	const cardNameWithoutMetadata = cardName.slice(0, match.index).trim();
	if (!Number.isFinite(have) || have < 0 || !cardNameWithoutMetadata) {
		return { cardName };
	}

	return {
		cardName: cardNameWithoutMetadata,
		have,
	};
}

function normalizeSectionName(section: string): string {
	return section.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseSectionLabel(line: string, commanderMarker?: string): ParsedSectionLabel | null {
	if (commanderMarker && line.localeCompare(commanderMarker, undefined, { sensitivity: "accent" }) === 0) {
		return {
			name: "Commander",
			isCommander: true,
		};
	}

	const headingMatch = /^#{1,6}\s+(.+?)\s*$/.exec(line);
	if (headingMatch?.[1]) {
		const name = headingMatch[1].trim().replace(/:\s*$/, "");
		return {
			name,
			isCommander: normalizeSectionName(name) === "commander",
		};
	}

	const match = /^\s*-\s*(.+?)\s*:\s*$/.exec(line);
	if (!match?.[1]) {
		return null;
	}

	const name = match[1].trim();
	return {
		name,
		isCommander: normalizeSectionName(name) === "commander",
	};
}

function parseCardLine(
	line: string,
	minimumQuantity: number,
	parseInlineHave: boolean
): ParsedDeckCard | null {
	const normalizedLine = stripListMarker(line);

	for (const pattern of CARD_LINE_PATTERNS) {
		const match = pattern.exec(normalizedLine);
		if (!match) continue;

		const quantity = Number.parseInt(match[1] ?? "", 10);
		const parsedMetadata = parseInlineHave
			? parseHaveMetadata(match[2] ?? "")
			: { cardName: match[2] ?? "" };
		const cardName = normalizeParsedCardName(parsedMetadata.cardName);
		if (!Number.isFinite(quantity) || quantity < minimumQuantity || !cardName) {
			return null;
		}

		return { quantity, cardName, have: parsedMetadata.have };
	}

	if (minimumQuantity > 0) {
		const parsedMetadata = parseInlineHave
			? parseHaveMetadata(normalizedLine)
			: { cardName: normalizedLine };
		const cardName = normalizeParsedCardName(parsedMetadata.cardName);
		if (cardName) {
			return {
				quantity: 1,
				cardName,
				have: parsedMetadata.have,
			};
		}
	}

	return null;
}

function parseFormatLine(line: string): string | null {
	const match = /^format\s*:\s*(.+?)\s*$/i.exec(line);
	if (!match?.[1]) {
		return null;
	}

	return match[1].trim().toLowerCase();
}

function parseCommanderLine(line: string, parseInlineHave: boolean): ParsedDeckCard | null {
	const match = /^commander\s*:\s*(.+?)\s*$/i.exec(line);
	if (!match?.[1]) {
		return null;
	}

	const parsed = parseCardLine(match[1], 1, parseInlineHave);
	if (!parsed) {
		return null;
	}

	return {
		...parsed,
		section: "Commander",
	};
}

function parseCardList(
	source: string,
	options: {
		commanderMarker?: string;
		minimumQuantity: number;
		parseInlineHave: boolean;
	}
): ParsedDeck {
	const cards = new Map<string, ParsedDeckCard>();
	let currentSection: string | undefined;
	let currentSectionIsTransient = false;
	let parsedCardsInCurrentSection = 0;
	let format: string | undefined;

	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) {
			if (currentSectionIsTransient && parsedCardsInCurrentSection > 0) {
				currentSection = undefined;
				currentSectionIsTransient = false;
				parsedCardsInCurrentSection = 0;
			}
			continue;
		}

		const parsedFormat = parseFormatLine(line);
		if (parsedFormat) {
			format = parsedFormat;
			continue;
		}

		const commanderCard = parseCommanderLine(line, options.parseInlineHave);
		if (commanderCard) {
			const key = commanderCard.cardName.toLowerCase();
			const existing = cards.get(key);
			if (existing) {
				existing.quantity += commanderCard.quantity;
				if (commanderCard.have !== undefined) {
					existing.have = (existing.have ?? 0) + commanderCard.have;
				}
				existing.section = "Commander";
			} else {
				cards.set(key, commanderCard);
			}
			continue;
		}

		const section = parseSectionLabel(line, options.commanderMarker?.trim());
		if (section) {
			currentSection = section.name;
			currentSectionIsTransient = section.isCommander;
			parsedCardsInCurrentSection = 0;
			continue;
		}

		const parsedCard = parseCardLine(line, options.minimumQuantity, options.parseInlineHave);
		if (!parsedCard) continue;

		const key = parsedCard.cardName.toLowerCase();
		const existing = cards.get(key);
		if (existing) {
			existing.quantity += parsedCard.quantity;
			if (parsedCard.have !== undefined) {
				existing.have = (existing.have ?? 0) + parsedCard.have;
			}
			if (!existing.section && currentSection) {
				existing.section = currentSection;
			}
			continue;
		}

		cards.set(key, {
			...parsedCard,
			section: currentSection,
		});
		parsedCardsInCurrentSection += 1;
	}

	return {
		cards: Array.from(cards.values()),
		format,
	};
}

export function parseDeckList(source: string, commanderMarker?: string): ParsedDeck {
	return parseCardList(source, {
		commanderMarker,
		minimumQuantity: 1,
		parseInlineHave: true,
	});
}

export function parseCollectionList(source: string): ParsedDeck {
	return parseCardList(source, {
		minimumQuantity: 0,
		parseInlineHave: false,
	});
}
