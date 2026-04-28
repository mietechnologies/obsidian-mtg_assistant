import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { ParsedDeckCard, parseDeckList } from "../parser/deckParser";
import { attachHoverEvents, MtgPopover } from "./cardImageRenderer";
import { MTGSettings } from "../settings";

interface DeckRow {
	quantity: number;
	cardName: string;
	section: string;
	priceText: string;
	priceValue: number | null;
}

interface DeckTotals {
	totalQuantity: number;
	totalPrice: number;
	hasEstimatedPrices: boolean;
}

const DEFAULT_SECTION_ORDER = [
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

function normalizeSectionName(section: string): string {
	return section
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

function titleCaseSection(section: string): string {
	return section
		.trim()
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");
}

function inferSection(typeLine?: string): string {
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

function getUnitUsdPrice(result: CardPreviewResult): number | null {
	const usd = result.card?.prices?.usd;
	if (!usd) return null;

	const value = Number.parseFloat(usd);
	return Number.isFinite(value) ? value : null;
}

function formatLinePrice(quantity: number, unitPrice: number | null): string {
	if (unitPrice === null) return "N/A";
	return `$${(quantity * unitPrice).toFixed(2)}`;
}

function formatDeckTotal(totals: DeckTotals): string {
	const prefix = totals.hasEstimatedPrices ? "~" : "";
	return `${prefix}$${totals.totalPrice.toFixed(2)}`;
}

function sectionSortKey(section: string): number {
	const normalized = normalizeSectionName(section);
	const index = DEFAULT_SECTION_ORDER.findIndex(
		(candidate) => normalizeSectionName(candidate) === normalized
	);
	return index >= 0 ? index : DEFAULT_SECTION_ORDER.length;
}

function sortRows(rows: DeckRow[]): DeckRow[] {
	return [...rows].sort((left, right) => {
		const sectionDelta = sectionSortKey(left.section) - sectionSortKey(right.section);
		if (sectionDelta !== 0) return sectionDelta;

		const sectionNameDelta = left.section.localeCompare(right.section);
		if (sectionNameDelta !== 0) return sectionNameDelta;

		return left.cardName.localeCompare(right.cardName);
	});
}

async function mapDeckRows(
	cards: ParsedDeckCard[],
	cache: CardCache,
	concurrency = 4
): Promise<DeckRow[]> {
	const rows: DeckRow[] = [];
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		while (nextIndex < cards.length) {
			const currentIndex = nextIndex++;
			const card = cards[currentIndex];
			if (!card) {
				continue;
			}
			const resolved = await cache.resolveCard(card.cardName);
			const section = card.section
				? titleCaseSection(card.section)
				: inferSection(resolved.card?.typeLine);
			const unitPrice = getUnitUsdPrice(resolved);

			rows[currentIndex] = {
				quantity: card.quantity,
				cardName: resolved.cardName,
				section,
				priceText: formatLinePrice(card.quantity, unitPrice),
				priceValue: unitPrice,
			};
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(concurrency, Math.max(cards.length, 1)) }, () => worker())
	);
	return sortRows(rows);
}

function createCardNameCell(
	row: DeckRow,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): HTMLTableCellElement {
	const cell = document.createElement("td");
	const span = document.createElement("span");
	span.className = "mtg-card-ref";
	span.textContent = row.cardName;
	span.tabIndex = 0;
	span.setAttribute("role", "button");
	span.setAttribute("aria-label", `Show Magic card preview for ${row.cardName}`);
	attachHoverEvents(span, row.cardName, cache, getSettings, popover);
	cell.appendChild(span);
	return cell;
}

function renderTableRows(
	tableBody: HTMLElement,
	rows: DeckRow[],
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): void {
	let currentSection = "";

	for (const row of rows) {
		if (row.section !== currentSection) {
			currentSection = row.section;
			const sectionRow = tableBody.createEl("tr", { cls: "mtg-deck-section-row" });
			const sectionCell = sectionRow.createEl("td", {
				text: currentSection,
				cls: "mtg-deck-section-cell",
			});
			sectionCell.colSpan = 3;
		}

		const tr = tableBody.createEl("tr");
		tr.createEl("td", { text: String(row.quantity), cls: "mtg-deck-qty" });
		tr.appendChild(createCardNameCell(row, cache, getSettings, popover));
		tr.createEl("td", { text: row.priceText, cls: "mtg-deck-price" });
	}
}

function calculateTotals(rows: DeckRow[]): DeckTotals {
	let totalQuantity = 0;
	let totalPrice = 0;
	let hasEstimatedPrices = false;

	for (const row of rows) {
		totalQuantity += row.quantity;
		if (row.priceValue === null) {
			hasEstimatedPrices = true;
			continue;
		}

		totalPrice += row.quantity * row.priceValue;
	}

	return { totalQuantity, totalPrice, hasEstimatedPrices };
}

function renderTableFooter(table: HTMLElement, rows: DeckRow[]): void {
	const totals = calculateTotals(rows);
	const tfoot = table.createEl("tfoot");
	const footerRow = tfoot.createEl("tr", { cls: "mtg-deck-footer-row" });
	footerRow.createEl("td", {
		text: String(totals.totalQuantity),
		cls: "mtg-deck-qty mtg-deck-footer-cell",
	});
	footerRow.createEl("td", {
		text: "Total",
		cls: "mtg-deck-footer-cell",
	});
	footerRow.createEl("td", {
		text: formatDeckTotal(totals),
		cls: "mtg-deck-price mtg-deck-footer-cell",
	});
}

export async function renderDeckTable(
	containerEl: HTMLElement,
	source: string,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): Promise<void> {
	containerEl.empty();
	containerEl.addClass("mtg-deck-block");

	const parsed = parseDeckList(source, getSettings().commanderMarker);
	if (parsed.cards.length === 0) {
		containerEl.createEl("p", {
			text: "No deck cards found in this block.",
			cls: "mtg-card-popover-message",
		});
		return;
	}

	const loadingEl = containerEl.createEl("p", {
		text: "Loading deck data…",
		cls: "mtg-card-popover-message",
	});

	const rows = await mapDeckRows(parsed.cards, cache);
	if (!loadingEl.isConnected) {
		return;
	}

	containerEl.empty();

	const table = containerEl.createEl("table", { cls: "mtg-deck-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Current price" });

	const tbody = table.createEl("tbody");
	renderTableRows(tbody, rows, cache, getSettings, popover);
	renderTableFooter(table, rows);
}
