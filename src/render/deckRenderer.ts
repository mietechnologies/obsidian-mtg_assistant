import { App } from "obsidian";
import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { CollectionIndex } from "../collection/collectionIndex";
import tcgPlayerSvg from "../img/tcg_player.svg";
import { ParsedDeckCard, parseDeckList } from "../parser/deckParser";
import { attachHoverEvents, MtgPopover } from "./cardImageRenderer";
import { MTGSettings } from "../settings";
import { inferSection, normalizeSectionName, sectionSortKey, titleCaseSection } from "./cardSections";
import { createColorIdentityElement } from "./colorIdentity";
import { createInlineWarning, createRateLimitWarning } from "./lookupWarning";

type DeckFormat = "standard" | "pioneer" | "modern" | "pauper" | "commander" | "brawl" | "duel" | "oathbreaker" | "legacy" | "vintage";
type DeckLegalityStatus = "legal" | "not_legal" | "banned" | "restricted" | null;

const SUPPORTED_DECK_FORMATS = new Set<DeckFormat>([
	"standard",
	"pioneer",
	"modern",
	"pauper",
	"commander",
	"brawl",
	"duel",
	"oathbreaker",
	"legacy",
	"vintage",
]);
const SUPPORTED_DECK_FORMAT_LABELS = Array.from(SUPPORTED_DECK_FORMATS.values())
	.map((format) => formatDeckFormatLabel(format))
	.join(", ");

interface DeckRow {
	lookupName: string;
	quantity: number;
	cardName: string;
	section: string;
	typeLine?: string;
	manaValue?: number;
	colorIdentity: string[];
	keywords: string[];
	priceText: string;
	priceValue: number | null;
	rateLimitedMessage?: string;
	deckLegalityStatus?: DeckLegalityStatus;
	deckLegalityMessage?: string;
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

interface AnalyticsBucket {
	label: string;
	count: number;
}

interface KeywordAnalyticsRow {
	keyword: string;
	count: number;
	averageManaValue: number | null;
}

interface DeckAnalytics {
	totalCards: number;
	landCount: number;
	nonlandCount: number;
	averageManaValue: number | null;
	colorIdentity: string[];
	distinctKeywordCount: number;
	manaCurve: AnalyticsBucket[];
	typeDistribution: AnalyticsBucket[];
	keywords: KeywordAnalyticsRow[];
}

interface DeckValidationIssue {
	severity: "error" | "warning";
	message: string;
}

const DECK_RENDER_TOKEN_ATTR = "data-mtg-deck-render-token";

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

function formatDeckFormatLabel(format: string): string {
	return format
		.split(/[-_\s]+/)
		.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
		.join(" ");
}

function normalizeDeckFormat(format: string | undefined): DeckFormat | null {
	if (!format) {
		return null;
	}

	const normalized = format.trim().toLowerCase() as DeckFormat;
	return SUPPORTED_DECK_FORMATS.has(normalized) ? normalized : null;
}

function getDeckLegalityStatus(
	legalities: Record<string, string> | undefined,
	deckFormat: DeckFormat | null
): DeckLegalityStatus {
	if (!deckFormat || !legalities) {
		return null;
	}

	const status = legalities[deckFormat];
	switch (status) {
		case "legal":
		case "not_legal":
		case "banned":
		case "restricted":
			return status;
		default:
			return null;
	}
}

function getDeckLegalityMessage(cardName: string, deckFormat: DeckFormat, status: DeckLegalityStatus): string | undefined {
	switch (status) {
		case "banned":
			return `${cardName} is banned in ${deckFormat}.`;
		case "not_legal":
			return `${cardName} is not legal in ${deckFormat}.`;
		case "restricted":
			return `${cardName} is restricted in ${deckFormat}.`;
		default:
			return undefined;
	}
}

function isLandType(typeLine: string | undefined): boolean {
	return typeLine?.toLowerCase().includes("land") ?? false;
}

function classifyCardType(typeLine: string | undefined): string {
	const normalized = typeLine?.toLowerCase() ?? "";
	if (normalized.includes("land")) return "Land";
	if (normalized.includes("creature")) return "Creature";
	if (normalized.includes("instant")) return "Instant";
	if (normalized.includes("sorcery")) return "Sorcery";
	if (normalized.includes("artifact")) return "Artifact";
	if (normalized.includes("enchantment")) return "Enchantment";
	if (normalized.includes("planeswalker")) return "Planeswalker";
	if (normalized.includes("battle")) return "Battle";
	return "Other";
}

function formatAverageManaValue(value: number | null): string {
	return value === null ? "N/A" : value.toFixed(1);
}

function formatPercent(value: number, total: number): string {
	if (total === 0) return "0%";
	return `${Math.round((value / total) * 100)}%`;
}

function isCommanderSection(section: string): boolean {
	return normalizeSectionName(section) === "commander";
}

function isBasicLand(row: DeckRow): boolean {
	const normalizedTypeLine = row.typeLine?.toLowerCase() ?? "";
	return normalizedTypeLine.includes("basic") && normalizedTypeLine.includes("land");
}

function formatCardQuantityList(rows: Array<{ cardName: string; quantity: number }>, limit = 4): string {
	const slice = rows.slice(0, limit).map((row) => `${row.cardName} (${row.quantity})`);
	if (rows.length > limit) {
		slice.push(`+${rows.length - limit} more`);
	}
	return slice.join(", ");
}

function buildDeckValidation(rows: DeckRow[], deckFormat: DeckFormat | null): DeckValidationIssue[] {
	if (!deckFormat) {
		return [];
	}

	const issues: DeckValidationIssue[] = [];
	const totalCards = rows.reduce((sum, row) => sum + row.quantity, 0);
	const exactSizeByFormat: Partial<Record<DeckFormat, number>> = {
		commander: 100,
		brawl: 60,
		oathbreaker: 60,
		duel: 100,
	};
	const requiresCommanderSection = new Set<DeckFormat>([
		"commander",
		"brawl",
		"oathbreaker",
		"duel",
	]);
	const singletonFormats = requiresCommanderSection;

	const expectedSize = exactSizeByFormat[deckFormat];
	if (expectedSize !== undefined && totalCards !== expectedSize) {
		issues.push({
			severity: "error",
			message: `${formatDeckFormatLabel(deckFormat)} decks should contain exactly ${expectedSize} cards. Found ${totalCards}.`,
		});
	}

	if (requiresCommanderSection.has(deckFormat)) {
		const commanderCount = rows
			.filter((row) => isCommanderSection(row.section))
			.reduce((sum, row) => sum + row.quantity, 0);
		if (commanderCount !== 1) {
			issues.push({
				severity: "error",
				message: `${formatDeckFormatLabel(deckFormat)} decks should have exactly 1 commander entry. Found ${commanderCount}.`,
			});
		}
	}

	if (singletonFormats.has(deckFormat)) {
		const duplicates = rows.filter((row) => row.quantity > 1 && !isBasicLand(row));
		if (duplicates.length > 0) {
			issues.push({
				severity: "error",
				message: `${formatDeckFormatLabel(deckFormat)} decks should be singleton outside basic lands. Duplicate entries: ${formatCardQuantityList(duplicates)}.`,
			});
		}
	}

	if (deckFormat === "vintage") {
		const restrictedOverages = rows.filter(
			(row) => row.deckLegalityStatus === "restricted" && row.quantity > 1
		);
		if (restrictedOverages.length > 0) {
			issues.push({
				severity: "error",
				message: `Vintage restricted cards exceed the allowed quantity of 1: ${formatCardQuantityList(restrictedOverages)}.`,
			});
		}
	}

	return issues;
}

function createSvgElement(svgMarkup: string): SVGElement | null {
	const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
	const svg = doc.documentElement;
	return svg instanceof SVGElement ? svg : null;
}

function buildTcgPlayerMassEntryUrl(rows: DeckDeficitRow[]): string | null {
	if (rows.length === 0) {
		return null;
	}

	const content = rows
		.filter((row) => row.missing > 0)
		.map((row) => `${row.missing} ${row.cardName}`)
		.join("||");

	if (!content) {
		return null;
	}

	const params = new URLSearchParams({
		productline: "Magic",
		c: content,
	});
	return `https://www.tcgplayer.com/massentry?${params.toString()}`;
}

function createTcgPlayerButton(rows: DeckDeficitRow[]): HTMLAnchorElement | null {
	const url = buildTcgPlayerMassEntryUrl(rows);
	if (!url) {
		return null;
	}

	const link = document.createElement("a");
	link.className = "mtg-tcgplayer-button";
	link.href = url;
	link.target = "_blank";
	link.rel = "noopener noreferrer";
	link.setAttribute("aria-label", "Open missing cards in mass entry");

	const icon = createSvgElement(tcgPlayerSvg);
	if (icon) {
		icon.classList.add("mtg-tcgplayer-button-icon");
		icon.setAttribute("aria-hidden", "true");
		link.appendChild(icon);
	}

	const label = document.createElement("span");
	label.textContent = "Buy missing cards";
	link.appendChild(label);
	return link;
}

async function buildDeckCollectionCoverage(
	rows: DeckRow[],
	collectionTotalsPromise: Promise<{
		quantities: Map<string, number>;
		sourceFileCount: number;
		sourceBlockCount: number;
	}>
): Promise<DeckCollectionCoverage> {
	const collection = await collectionTotalsPromise;
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
	deckFormat: DeckFormat | null,
	onProgress?: (completed: number, total: number) => void
): Promise<DeckRow[]> {
	const resolvedMap = await cache.resolveCardsMetadata(
		cards.map((card) => card.cardName),
		onProgress
	);
	return sortRows(
		cards.map((card) => {
			const resolved =
				resolvedMap.get(normalizeCardKey(card.cardName)) ?? {
					status: "not-found" as const,
					cardName: card.cardName,
				};
			const section = card.section
				? titleCaseSection(card.section)
				: inferSection(resolved.card?.typeLine);
			const unitPrice = getUnitUsdPrice(resolved);
			const deckLegalityStatus = getDeckLegalityStatus(
				resolved.card?.legalities,
				deckFormat
			);

			return {
				lookupName: card.cardName,
				quantity: card.quantity,
				cardName: resolved.cardName,
				section,
				typeLine: resolved.card?.typeLine,
				manaValue: resolved.card?.manaValue,
				colorIdentity: resolved.card?.colorIdentity ?? [],
				keywords: resolved.card?.keywords ?? [],
				priceText: formatLinePrice(card.quantity, unitPrice),
				priceValue: unitPrice,
				rateLimitedMessage:
					resolved.status === "rate-limited" ? resolved.message : undefined,
				deckLegalityStatus,
				deckLegalityMessage:
					deckFormat && deckLegalityStatus
						? getDeckLegalityMessage(resolved.cardName, deckFormat, deckLegalityStatus)
						: undefined,
			};
		})
	);
}

function createInitialDeckRows(cards: ParsedDeckCard[]): DeckRow[] {
	return sortRows(
		cards.map((card) => ({
			lookupName: card.cardName,
			quantity: card.quantity,
			cardName: card.cardName,
			section: card.section ? titleCaseSection(card.section) : "Other",
			typeLine: undefined,
			manaValue: undefined,
			colorIdentity: [],
			keywords: [],
			priceText: "Loading…",
			priceValue: null,
		}))
	);
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
	const isInvalidForDeck =
		row.deckLegalityStatus === "banned" || row.deckLegalityStatus === "not_legal";
	span.className = isInvalidForDeck ? "mtg-card-ref is-invalid-for-deck" : "mtg-card-ref";
	span.textContent = row.cardName;
	span.tabIndex = 0;
	span.setAttribute("role", "button");
	span.setAttribute("aria-label", `Show Magic card preview for ${row.cardName}`);
	attachHoverEvents(span, row.cardName, cache, getSettings, popover);
	cell.appendChild(span);
	if (isInvalidForDeck) {
		cell.appendChild(
			createInlineWarning(row.deckLegalityMessage, {
				label: `Deck legality warning for ${row.cardName}`,
				symbol: "⚠️",
			})
		);
	}
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

function renderTableFooter(table: HTMLElement, rows: DeckRow[], totalTextOverride?: string): void {
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
		text: totalTextOverride ?? formatDeckTotal(totals),
		cls: "mtg-deck-price mtg-deck-footer-cell",
	});
}

function renderUnsupportedDeckFormatWarning(
	containerEl: HTMLElement,
	rawFormat: string | undefined,
	deckFormat: DeckFormat | null
): void {
	if (!rawFormat || deckFormat) {
		return;
	}

	const warningRow = containerEl.createEl("p", { cls: "mtg-deck-validation-message" });
	warningRow.appendChild(
		createInlineWarning(
			`Unsupported deck format "${rawFormat}". Supported formats: ${SUPPORTED_DECK_FORMAT_LABELS}.`,
			{
				label: "Unsupported deck format",
				symbol: "⚠️",
			}
		)
	);
	warningRow.append(" Deck legality validation skipped.");
}

function renderResolvedDeckContent(
	containerEl: HTMLElement,
	rows: DeckRow[],
	coverage: DeckCollectionCoverage,
	analytics: DeckAnalytics,
	validationIssues: DeckValidationIssue[],
	deckFormat: DeckFormat | null,
	rawFormat: string | undefined,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>
): void {
	renderUnsupportedDeckFormatWarning(containerEl, rawFormat, deckFormat);

	const table = containerEl.createEl("table", { cls: "mtg-deck-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Current price" });

	const tbody = table.createEl("tbody");
	renderTableRows(tbody, rows, cache, getSettings, popover, onRetry);
	renderTableFooter(table, rows);
	renderCollectionCoverageSection(containerEl, coverage, cache, getSettings, popover, onRetry);
	renderDeckAnalyticsSection(containerEl, analytics, validationIssues, deckFormat, rawFormat);
}

function buildDeckAnalytics(rows: DeckRow[]): DeckAnalytics {
	const manaCurveMap = new Map<string, number>([
		["0", 0],
		["1", 0],
		["2", 0],
		["3", 0],
		["4", 0],
		["5", 0],
		["6+", 0],
		["Lands", 0],
	]);
	const typeCounts = new Map<string, number>();
	const keywordCounts = new Map<string, { count: number; manaValueTotal: number; manaValueCount: number }>();
	const colorIdentity = new Set<string>();
	let totalCards = 0;
	let landCount = 0;
	let nonlandCount = 0;
	let manaValueTotal = 0;
	let manaValueCount = 0;

	for (const row of rows) {
		totalCards += row.quantity;
		const isLand = isLandType(row.typeLine);
		if (isLand) {
			landCount += row.quantity;
			manaCurveMap.set("Lands", (manaCurveMap.get("Lands") ?? 0) + row.quantity);
		} else {
			nonlandCount += row.quantity;
			const manaValue = row.manaValue ?? 0;
			manaValueTotal += manaValue * row.quantity;
			manaValueCount += row.quantity;
			const manaCurveKey = manaValue >= 6 ? "6+" : String(Math.max(0, Math.floor(manaValue)));
			manaCurveMap.set(manaCurveKey, (manaCurveMap.get(manaCurveKey) ?? 0) + row.quantity);
		}

		const typeLabel = classifyCardType(row.typeLine);
		typeCounts.set(typeLabel, (typeCounts.get(typeLabel) ?? 0) + row.quantity);

		for (const symbol of row.colorIdentity) {
			colorIdentity.add(symbol);
		}

		for (const keyword of row.keywords) {
			const current = keywordCounts.get(keyword) ?? {
				count: 0,
				manaValueTotal: 0,
				manaValueCount: 0,
			};
			current.count += row.quantity;
			if (row.manaValue !== undefined) {
				current.manaValueTotal += row.manaValue * row.quantity;
				current.manaValueCount += row.quantity;
			}
			keywordCounts.set(keyword, current);
		}
	}

	const manaCurve = Array.from(manaCurveMap.entries()).map(([label, count]) => ({ label, count }));
	const typeOrder = [
		"Creature",
		"Land",
		"Instant",
		"Sorcery",
		"Artifact",
		"Enchantment",
		"Planeswalker",
		"Battle",
		"Other",
	];
	const typeDistribution = typeOrder
		.map((label) => ({ label, count: typeCounts.get(label) ?? 0 }))
		.filter((bucket) => bucket.count > 0);
	const keywords = Array.from(keywordCounts.entries())
		.map(([keyword, entry]) => ({
			keyword,
			count: entry.count,
			averageManaValue:
				entry.manaValueCount > 0 ? entry.manaValueTotal / entry.manaValueCount : null,
		}))
		.sort((left, right) => {
			if (right.count !== left.count) {
				return right.count - left.count;
			}
			return left.keyword.localeCompare(right.keyword);
		});

	return {
		totalCards,
		landCount,
		nonlandCount,
		averageManaValue: manaValueCount > 0 ? manaValueTotal / manaValueCount : null,
		colorIdentity: Array.from(colorIdentity.values()),
		distinctKeywordCount: keywords.length,
		manaCurve,
		typeDistribution,
		keywords,
	};
}

function renderAnalyticsStat(
	containerEl: HTMLElement,
	label: string,
	value: string | HTMLElement
): void {
	const card = containerEl.createEl("div", { cls: "mtg-deck-analytics-stat" });
	const valueEl = card.createEl("div", {
		cls: "mtg-deck-analytics-stat-value",
	});
	if (typeof value === "string") {
		valueEl.textContent = value;
	} else {
		valueEl.appendChild(value);
	}
	card.createEl("div", {
		text: label,
		cls: "mtg-deck-analytics-stat-label",
	});
}

function createCollapsibleSection(
	containerEl: HTMLElement,
	sectionClassName: string,
	title: string
): HTMLElement {
	const details = containerEl.createEl("details", {
		cls: `${sectionClassName} mtg-collapsible-section`,
	});
	const summary = details.createEl("summary", { cls: "mtg-collapsible-summary" });
	summary.createEl("h4", {
		text: title,
		cls: "mtg-collapsible-heading",
	});
	return details.createEl("div", { cls: "mtg-collapsible-content" });
}

function quantizeScale(value: number, max: number, levels = 12, minimumVisible = 1): number {
	if (value <= 0 || max <= 0) {
		return 0;
	}

	const scaled = Math.round((value / max) * levels);
	return Math.max(minimumVisible, Math.min(levels, scaled));
}

function renderManaCurveChart(containerEl: HTMLElement, buckets: AnalyticsBucket[]): void {
	const section = containerEl.createEl("section", { cls: "mtg-deck-analytics-panel" });
	section.createEl("h5", {
		text: "Mana curve",
		cls: "mtg-deck-analytics-subheading",
	});

	const chart = section.createEl("div", { cls: "mtg-deck-curve-chart" });
	const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);

	for (const bucket of buckets) {
		const column = chart.createEl("div", { cls: "mtg-deck-curve-column" });
		column.createEl("span", {
			text: String(bucket.count),
			cls: "mtg-deck-curve-value",
		});
		const level = quantizeScale(bucket.count, maxCount);
		column.createEl("div", {
			cls: `mtg-deck-curve-bar is-level-${level}`,
		});
		column.createEl("span", {
			text: bucket.label,
			cls: "mtg-deck-curve-label",
		});
	}
}

function renderTypeDistribution(containerEl: HTMLElement, buckets: AnalyticsBucket[], totalCards: number): void {
	const section = containerEl.createEl("section", { cls: "mtg-deck-analytics-panel" });
	section.createEl("h5", {
		text: "Type distribution",
		cls: "mtg-deck-analytics-subheading",
	});

	const bar = section.createEl("div", { cls: "mtg-deck-type-bar" });
	for (const bucket of buckets) {
		const spanLevel = quantizeScale(bucket.count, Math.max(totalCards, 1));
		bar.createEl("span", {
			cls: `mtg-deck-type-segment is-${normalizeCardKey(bucket.label).replace(/[^a-z0-9]+/g, "-")} is-span-${spanLevel}`,
		});
	}

	const legend = section.createEl("div", { cls: "mtg-deck-type-legend" });
	for (const bucket of buckets) {
		const row = legend.createEl("div", { cls: "mtg-deck-type-legend-row" });
		row.createEl("span", {
			cls: `mtg-deck-type-dot is-${normalizeCardKey(bucket.label).replace(/[^a-z0-9]+/g, "-")}`,
		});
		row.createEl("span", {
			text: bucket.label,
			cls: "mtg-deck-type-legend-label",
		});
		row.createEl("span", {
			text: `${bucket.count} · ${formatPercent(bucket.count, totalCards)}`,
			cls: "mtg-deck-type-legend-value",
		});
	}
}

function renderKeywordTable(containerEl: HTMLElement, keywords: KeywordAnalyticsRow[]): void {
	const section = containerEl.createEl("section", { cls: "mtg-deck-analytics-panel" });
	section.createEl("h5", {
		text: "Card keywords",
		cls: "mtg-deck-analytics-subheading",
	});

	if (keywords.length === 0) {
		section.createEl("p", {
			text: "No keyword data found for this deck.",
			cls: "mtg-deck-analytics-empty",
		});
		return;
	}

	const table = section.createEl("table", { cls: "mtg-deck-keyword-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Count" });
	headRow.createEl("th", { text: "Keyword" });
	headRow.createEl("th", { text: "AMV" });

	const tbody = table.createEl("tbody");
	for (const row of keywords) {
		const tr = tbody.createEl("tr");
		tr.createEl("td", { text: String(row.count) });
		tr.createEl("td", { text: row.keyword });
		tr.createEl("td", { text: formatAverageManaValue(row.averageManaValue) });
	}
}

function renderDeckValidationPanel(
	containerEl: HTMLElement,
	issues: DeckValidationIssue[],
	deckFormat: DeckFormat
): void {
	const section = containerEl.createEl("section", {
		cls: "mtg-deck-analytics-panel mtg-deck-validation-panel",
	});
	section.createEl("h5", {
		text: "Validation",
		cls: "mtg-deck-analytics-subheading",
	});

	if (issues.length === 0) {
		section.createEl("p", {
			text: `No validation issues found for ${formatDeckFormatLabel(deckFormat)}.`,
			cls: "mtg-deck-validation-status is-valid",
		});
		return;
	}

	section.createEl("p", {
		text: `${issues.length} validation issue${issues.length === 1 ? "" : "s"} found.`,
		cls: "mtg-deck-validation-status is-invalid",
	});

	const list = section.createEl("ul", { cls: "mtg-deck-validation-list" });
	for (const issue of issues) {
		const item = list.createEl("li", {
			cls: `mtg-deck-validation-item is-${issue.severity}`,
		});
		item.textContent = issue.message;
	}
}

function renderDeckAnalyticsSection(
	containerEl: HTMLElement,
	analytics: DeckAnalytics,
	validationIssues: DeckValidationIssue[],
	deckFormat: DeckFormat | null,
	rawFormat: string | undefined
): void {
	const section = createCollapsibleSection(
		containerEl,
		"mtg-deck-analytics-section",
		"Deck analytics"
	);
	const header = section.createEl("div", { cls: "mtg-deck-analytics-header" });
	if (deckFormat) {
		header.createEl("span", {
			text: formatDeckFormatLabel(deckFormat),
			cls: "mtg-deck-analytics-format-badge",
		});
	} else if (rawFormat) {
		header.createEl("span", {
			text: formatDeckFormatLabel(rawFormat),
			cls: "mtg-deck-analytics-format-badge is-unsupported",
		});
	}

	if (deckFormat) {
		renderDeckValidationPanel(section, validationIssues, deckFormat);
	}

	const stats = section.createEl("div", { cls: "mtg-deck-analytics-stats" });
	renderAnalyticsStat(stats, "Total cards", String(analytics.totalCards));
	renderAnalyticsStat(stats, "Average MV", formatAverageManaValue(analytics.averageManaValue));
	renderAnalyticsStat(stats, "Colors", createColorIdentityElement(analytics.colorIdentity));

	const panels = section.createEl("div", { cls: "mtg-deck-analytics-grid" });
	renderManaCurveChart(panels, analytics.manaCurve);
	renderTypeDistribution(panels, analytics.typeDistribution, analytics.totalCards);
	renderKeywordTable(section, analytics.keywords.slice(0, 12));
}

function renderCollectionCoverageSection(
	containerEl: HTMLElement,
	coverage: DeckCollectionCoverage,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>
): void {
	const section = createCollapsibleSection(
		containerEl,
		"mtg-deck-deficit-section",
		"Collection coverage"
	);
	const collectionFolder = getSettings().collectionFolder.trim() || "the vault";

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

	const table = section.createEl("table", { cls: "mtg-deck-deficit-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Need" });
	headRow.createEl("th", { text: "Owned" });
	headRow.createEl("th", { text: "Missing" });
	headRow.createEl("th", { text: "Estimated cost" });

	const tbody = table.createEl("tbody");
	for (const row of coverage.rows) {
		const tr = tbody.createEl("tr");
		tr.appendChild(createCardNameCell(
			{
				lookupName: row.lookupName,
				quantity: row.needed,
				cardName: row.cardName,
				section: "",
				typeLine: undefined,
				manaValue: undefined,
				colorIdentity: [],
				keywords: [],
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

	const tfoot = table.createEl("tfoot");
	const footerRow = tfoot.createEl("tr", { cls: "mtg-deck-deficit-footer-row" });
	footerRow.createEl("td", {
		text: "Total missing cost",
		cls: "mtg-deck-deficit-footer-cell",
	});
	footerRow.createEl("td", {
		text: "",
		cls: "mtg-deck-deficit-footer-cell",
	});
	footerRow.createEl("td", {
		text: "",
		cls: "mtg-deck-deficit-footer-cell",
	});
	footerRow.createEl("td", {
		text: "",
		cls: "mtg-deck-deficit-footer-cell",
	});
	footerRow.createEl("td", {
		text: `${costPrefix}$${coverage.missingCostTotal.toFixed(2)}`,
		cls: "mtg-deck-price mtg-deck-deficit-footer-cell",
	});

	const tcgPlayerButton = createTcgPlayerButton(coverage.rows);
	if (tcgPlayerButton) {
		const actionRow = section.createEl("div", { cls: "mtg-deck-deficit-actions" });
		actionRow.appendChild(tcgPlayerButton);
	}
}

export async function renderDeckTable(
	app: App,
	containerEl: HTMLElement,
	source: string,
	cache: CardCache,
	collectionIndex: CollectionIndex,
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

	const deckFormat = normalizeDeckFormat(parsed.format);
	const collectionTotalsPromise = collectionIndex.loadTotals();
	containerEl.removeClass("is-updating");
	const renderToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	containerEl.setAttribute(DECK_RENDER_TOKEN_ATTR, renderToken);

	renderUnsupportedDeckFormatWarning(containerEl, parsed.format, deckFormat);

	const initialRows = createInitialDeckRows(parsed.cards);
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
			await renderDeckTable(
				app,
				containerEl,
				source,
				cache,
				collectionIndex,
				getSettings,
				popover
			);
		} finally {
			containerEl.removeClass("is-updating");
		}
	};
	renderTableRows(tbody, initialRows, cache, getSettings, popover, async () => Promise.resolve());
	renderTableFooter(table, initialRows, "Loading…");

	const metadataLoadingEl = containerEl.createEl("p", {
		text: `Loading deck metadata 0/${parsed.cards.length}…`,
		cls: "mtg-card-popover-message",
	});
	containerEl.createEl("p", {
		text: "Collection coverage will appear when deck metadata is ready.",
		cls: "mtg-card-popover-message",
	});
	containerEl.createEl("p", {
		text: "Deck analytics and validation will appear when deck metadata is ready.",
		cls: "mtg-card-popover-message",
	});

	void mapDeckRows(parsed.cards, cache, deckFormat, (completed, total) => {
		if (
			!metadataLoadingEl.isConnected ||
			containerEl.getAttribute(DECK_RENDER_TOKEN_ATTR) !== renderToken
		) {
			return;
		}

		metadataLoadingEl.textContent =
			completed >= total
				? "Finalizing deck metadata…"
				: `Loading deck metadata ${completed}/${total}…`;
	}).then(async (rows) => {
		const coverage = await buildDeckCollectionCoverage(rows, collectionTotalsPromise);
		const analytics = buildDeckAnalytics(rows);
		const validationIssues = buildDeckValidation(rows, deckFormat);
		if (
			!containerEl.isConnected ||
			containerEl.getAttribute(DECK_RENDER_TOKEN_ATTR) !== renderToken
		) {
			return;
		}

		containerEl.empty();
		containerEl.removeClass("is-updating");
		renderResolvedDeckContent(
			containerEl,
			rows,
			coverage,
			analytics,
			validationIssues,
			deckFormat,
			parsed.format,
			cache,
			getSettings,
			popover,
			onRetry
		);
	});
}
