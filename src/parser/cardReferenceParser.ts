export interface CardReference {
	cardName: string;
	fullMatch: string;
	index: number;
}

// Matches [prefix:Card Name] but NOT [prefix:Card Name](url) (standard Markdown links).
export function buildCardReferenceRegex(prefix: string): RegExp {
	const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`\\[${escaped}:([^\\]]+)\\](?!\\()`, "gi");
}

export function parseCardReferences(text: string, prefix: string): CardReference[] {
	const regex = buildCardReferenceRegex(prefix);
	const results: CardReference[] = [];
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const cardName = match[1]?.trim() ?? "";
		if (!cardName) continue;
		results.push({
			fullMatch: match[0] ?? "",
			cardName,
			index: match.index,
		});
	}

	return results;
}
