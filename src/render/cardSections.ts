export const DEFAULT_SECTION_ORDER = [
	"Commander",
	"Creatures",
	"Artifacts",
	"Enchantments",
	"Instants",
	"Sorceries",
	"Planeswalkers",
	"Battles",
	"Lands",
];

export function normalizeSectionName(section: string): string {
	return section
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

export function titleCaseSection(section: string): string {
	return section
		.trim()
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");
}

export function inferSection(typeLine?: string): string {
	if (!typeLine) return "Other";
	if (typeLine.includes("Land")) return "Lands";
	if (typeLine.includes("Creature")) return "Creatures";
	if (typeLine.includes("Artifact")) return "Artifacts";
	if (typeLine.includes("Enchantment")) return "Enchantments";
	if (typeLine.includes("Instant")) return "Instants";
	if (typeLine.includes("Sorcery")) return "Sorceries";
	if (typeLine.includes("Planeswalker")) return "Planeswalkers";
	if (typeLine.includes("Battle")) return "Battles";
	return "Other";
}

export function sectionSortKey(section: string): number {
	const normalized = normalizeSectionName(section);
	const index = DEFAULT_SECTION_ORDER.findIndex(
		(candidate) => normalizeSectionName(candidate) === normalized
	);
	return index >= 0 ? index : DEFAULT_SECTION_ORDER.length;
}
