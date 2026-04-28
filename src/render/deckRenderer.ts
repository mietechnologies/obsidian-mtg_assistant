import { App } from "obsidian";
import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { loadCollectionTotals } from "../collection/collectionIndex";
import { ParsedDeckCard, parseDeckList } from "../parser/deckParser";
import { attachHoverEvents, MtgPopover } from "./cardImageRenderer";
import { MTGSettings } from "../settings";
import { inferSection, sectionSortKey, titleCaseSection } from "./cardSections";
import { createRateLimitWarning } from "./lookupWarning";

interface DeckRow {
	lookupName: string;
	quantity: number;
	cardName: string;
	section: string;
	priceText: string;
	priceValue: number | null;
	rateLimitedMessage?: string;
}

interface DeckTotals {
	totalQuantity: number;
	totalPrice: number;
	hasEstimatedPrices: boolean;
}

interface DeckDeficitRow {
	lookupName: string;
	cardName: string;
	needed: number;
	owned: number;
	missing: number;
	missingCostText: string;
	missingCostValue: number | null;
}

interface DeckCollectionCoverage {
	sourceFileCount: number;
	sourceBlockCount: number;
	coveredQuantity: number;
	totalQuantity: number;
	missingQuantity: number;
	coveredCardCount: number;
	missingCardCount: number;
	missingCostTotal: number;
	hasEstimatedMissingCost: boolean;
	rows: DeckDeficitRow[];
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

function formatMissingCost(quantity: number, unitPrice: number | null): string {
	if (unitPrice === null) return "N/A";
	return `$${(quantity * unitPrice).toFixed(2)}`;
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

function normalizeCardKey(cardName: string): string {
	return cardName.trim().toLowerCase();
}

async function buildDeckCollectionCoverage(
	app: App,
	rows: DeckRow[],
	settings: MTGSettings
): Promise<DeckCollectionCoverage> {
	const collection = await loadCollectionTotals(app, settings);
	const rowsWithDeficits: DeckDeficitRow[] = [];
	let coveredQuantity = 0;
	let missingQuantity = 0;
	let coveredCardCount = 0;
	let missingCardCount = 0;
	let missingCostTotal = 0;
	let hasEstimatedMissingCost = false;

	for (const row of rows) {
		const owned = collection.quantities.get(normalizeCardKey(row.lookupName)) ?? 0;
		const covered = Math.min(row.quantity, owned);
		const missing = Math.max(0, row.quantity - owned);

		coveredQuantity += covered;
		if (missing === 0) {
			coveredCardCount += 1;
			continue;
		}

		missingQuantity += missing;
		missingCardCount += 1;
		if (row.priceValue === null) {
			hasEstimatedMissingCost = true;
		} else {
			missingCostTotal += missing * row.priceValue;
		}

		rowsWithDeficits.push({
			lookupName: row.lookupName,
			cardName: row.cardName,
			needed: row.quantity,
			owned,
			missing,
			missingCostText: formatMissingCost(missing, row.priceValue),
			missingCostValue: row.priceValue === null ? null : missing * row.priceValue,
		});
	}

	rowsWithDeficits.sort((left, right) => {
		if (right.missing !== left.missing) {
			return right.missing - left.missing;
		}
		return left.cardName.localeCompare(right.cardName);
	});

	return {
		sourceFileCount: collection.sourceFileCount,
		sourceBlockCount: collection.sourceBlockCount,
		coveredQuantity,
		totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
		missingQuantity,
		coveredCardCount,
		missingCardCount,
		missingCostTotal,
		hasEstimatedMissingCost,
		rows: rowsWithDeficits,
	};
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
				lookupName: card.cardName,
				quantity: card.quantity,
				cardName: resolved.cardName,
				section,
				priceText: formatLinePrice(card.quantity, unitPrice),
				priceValue: unitPrice,
				rateLimitedMessage:
					resolved.status === "rate-limited" ? resolved.message : undefined,
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
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>
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
	if (row.rateLimitedMessage) {
		cell.appendChild(createRateLimitWarning(row.rateLimitedMessage, () => onRetry(row.lookupName)));
	}
	return cell;
}

function renderTableRows(
	tableBody: HTMLElement,
	rows: DeckRow[],
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>
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
		tr.appendChild(createCardNameCell(row, cache, getSettings, popover, onRetry));
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

function renderCollectionCoverageSection(
	containerEl: HTMLElement,
	coverage: DeckCollectionCoverage,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>
): void {
	const section = containerEl.createEl("section", { cls: "mtg-deck-deficit-section" });
	const collectionFolder = getSettings().collectionFolder.trim() || "the vault";
	section.createEl("h4", {
		text: "Collection coverage",
		cls: "mtg-deck-deficit-heading",
	});

	const sourceSummary =
		coverage.sourceBlockCount === 0
			? `No collection blocks found in ${collectionFolder}.`
			: `Using ${coverage.sourceBlockCount} collection block${coverage.sourceBlockCount === 1 ? "" : "s"} across ${coverage.sourceFileCount} note${coverage.sourceFileCount === 1 ? "" : "s"}.`;
	section.createEl("p", {
		text: sourceSummary,
		cls: "mtg-deck-deficit-meta",
	});

	if (coverage.sourceBlockCount === 0) {
		section.createEl("p", {
			text: "Add one or more collection blocks in the configured collection folder to compare this deck against your inventory.",
			cls: "mtg-card-popover-message",
		});
		return;
	}

	const missingCopyLabel = coverage.missingQuantity === 1 ? "copy" : "copies";
	const missingCardLabel = coverage.missingCardCount === 1 ? "card" : "cards";
	const summaryText = `Own ${coverage.coveredQuantity}/${coverage.totalQuantity} copies for this deck. Missing ${coverage.missingQuantity} ${missingCopyLabel} across ${coverage.missingCardCount} ${missingCardLabel}.`;
	section.createEl("p", {
		text: summaryText,
		cls: "mtg-deck-deficit-summary",
	});

	if (coverage.rows.length === 0) {
		section.createEl("p", {
			text: "Your collection fully covers this deck list.",
			cls: "mtg-deck-deficit-complete",
		});
		return;
	}

	const costPrefix = coverage.hasEstimatedMissingCost ? "~" : "";
	section.createEl("p", {
		text: `Estimated missing cost: ${costPrefix}$${coverage.missingCostTotal.toFixed(2)}`,
		cls: "mtg-deck-deficit-summary",
	});

	const table = section.createEl("table", { cls: "mtg-deck-deficit-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Need" });
	headRow.createEl("th", { text: "Owned" });
	headRow.createEl("th", { text: "Missing" });
	headRow.createEl("th", { text: "Est. cost" });

	const tbody = table.createEl("tbody");
	for (const row of coverage.rows) {
		const tr = tbody.createEl("tr");
		tr.appendChild(createCardNameCell(
			{
				lookupName: row.lookupName,
				quantity: row.needed,
				cardName: row.cardName,
				section: "",
				priceText: row.missingCostText,
				priceValue: row.missingCostValue,
			},
			cache,
			getSettings,
			popover,
			onRetry
		));
		tr.createEl("td", { text: String(row.needed), cls: "mtg-deck-deficit-qty" });
		tr.createEl("td", { text: String(row.owned), cls: "mtg-deck-deficit-qty" });
		tr.createEl("td", { text: String(row.missing), cls: "mtg-deck-deficit-qty" });
		tr.createEl("td", { text: row.missingCostText, cls: "mtg-deck-price" });
	}
}

export async function renderDeckTable(
	app: App,
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
	const coverage = await buildDeckCollectionCoverage(app, rows, getSettings());
	if (!loadingEl.isConnected) {
		return;
	}

	containerEl.empty();
	containerEl.removeClass("is-updating");

	const table = containerEl.createEl("table", { cls: "mtg-deck-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Current price" });

	const tbody = table.createEl("tbody");
	const onRetry = async (cardName: string): Promise<void> => {
		containerEl.addClass("is-updating");
		try {
			await cache.evictCardLookup(cardName);
			await renderDeckTable(app, containerEl, source, cache, getSettings, popover);
		} finally {
			containerEl.removeClass("is-updating");
		}
	};
	renderTableRows(tbody, rows, cache, getSettings, popover, onRetry);
	renderTableFooter(table, rows);
	renderCollectionCoverageSection(containerEl, coverage, cache, getSettings, popover, onRetry);
}
