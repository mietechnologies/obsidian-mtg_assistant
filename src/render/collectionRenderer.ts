import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { ParsedDeckCard, parseCollectionList } from "../parser/deckParser";
import { MTGSettings } from "../settings";
import { attachHoverEvents, MtgPopover } from "./cardImageRenderer";
import { createColorIdentityElement } from "./colorIdentity";
import { inferSection, sectionSortKey, titleCaseSection } from "./cardSections";
import { createRateLimitWarning } from "./lookupWarning";

interface CollectionRow {
	key: string;
	lookupName: string;
	quantity: number;
	cardName: string;
	section: string;
	colorIdentity: string[];
	priceText: string;
	priceValue: number | null;
	rateLimitedMessage?: string;
}

interface RenderCollectionTableOptions {
	containerEl: HTMLElement;
	source: string;
	cache: CardCache;
	getSettings: () => MTGSettings;
	popover: MtgPopover;
	onUpdateSource: (nextSource: string) => void | Promise<void>;
	onActivateEditor?: () => void;
}

function normalizeCardKey(cardName: string): string {
	return cardName.trim().toLowerCase();
}

function getUnitUsdPrice(result: CardPreviewResult): number | null {
	const usd = result.card?.prices?.usd;
	if (!usd) return null;

	const value = Number.parseFloat(usd);
	return Number.isFinite(value) ? value : null;
}

function formatUnitPrice(unitPrice: number | null): string {
	if (unitPrice === null) return "N/A";
	return `$${unitPrice.toFixed(2)}`;
}

function sortRows(rows: CollectionRow[]): CollectionRow[] {
	return [...rows].sort((left, right) => {
		const sectionDelta = sectionSortKey(left.section) - sectionSortKey(right.section);
		if (sectionDelta !== 0) return sectionDelta;

		const sectionNameDelta = left.section.localeCompare(right.section);
		if (sectionNameDelta !== 0) return sectionNameDelta;

		return left.cardName.localeCompare(right.cardName);
	});
}

async function mapCollectionRows(
	cards: ParsedDeckCard[],
	cache: CardCache,
	concurrency = 4
): Promise<CollectionRow[]> {
	const rows: CollectionRow[] = [];
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		while (nextIndex < cards.length) {
			const currentIndex = nextIndex++;
			const card = cards[currentIndex];
			if (!card) continue;

			const resolved = await cache.resolveCard(card.cardName);
			const inferredSection = inferSection(resolved.card?.typeLine);
			const section =
				inferredSection !== "Other"
					? inferredSection
					: card.section
						? titleCaseSection(card.section)
						: inferredSection;
			const unitPrice = getUnitUsdPrice(resolved);

			rows[currentIndex] = {
				key: normalizeCardKey(resolved.cardName),
				lookupName: card.cardName,
				quantity: card.quantity,
				cardName: resolved.cardName,
				section,
				colorIdentity: resolved.card?.colorIdentity ?? [],
				priceText: formatUnitPrice(unitPrice),
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

function buildCollectionSource(rows: CollectionRow[]): string {
	const sortedRows = sortRows(rows);
	const sections = new Map<string, CollectionRow[]>();

	for (const row of sortedRows) {
		const existing = sections.get(row.section);
		if (existing) {
			existing.push(row);
			continue;
		}
		sections.set(row.section, [row]);
	}

	return Array.from(sections.entries())
		.map(([section, sectionRows]) => {
			const lines = [`- ${section}:`];
			for (const row of sectionRows) {
				lines.push(`${row.quantity} ${row.cardName}`);
			}
			return lines.join("\n");
		})
		.join("\n\n");
}

function adjustRows(
	rows: CollectionRow[],
	targetKey: string,
	delta: number,
	removeAtZero: boolean
): CollectionRow[] {
	const nextRows: CollectionRow[] = [];

	for (const row of rows) {
		if (row.key !== targetKey) {
			nextRows.push({ ...row });
			continue;
		}

		const nextQuantity = Math.max(0, row.quantity + delta);
		if (nextQuantity === 0 && removeAtZero) {
			continue;
		}

		nextRows.push({
			...row,
			quantity: nextQuantity,
		});
	}

	return nextRows;
}

function createCollectionCardCell(
	row: CollectionRow,
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

function createQuantityCell(
	row: CollectionRow,
	onAdjust: (key: string, delta: number) => Promise<void>
): HTMLTableCellElement {
	const cell = document.createElement("td");
	cell.className = "mtg-collection-qty";

	const wrapper = cell.createEl("div", { cls: "mtg-collection-qty-controls" });
	const decrement = wrapper.createEl("button", {
		text: "−",
		cls: "mtg-collection-stepper",
	});
	decrement.type = "button";
	decrement.setAttribute("aria-label", `Decrease ${row.cardName} quantity`);
	decrement.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void onAdjust(row.key, -1);
	});

	wrapper.createEl("span", {
		text: String(row.quantity),
		cls: "mtg-collection-qty-value",
	});

	const increment = wrapper.createEl("button", {
		text: "+",
		cls: "mtg-collection-stepper",
	});
	increment.type = "button";
	increment.setAttribute("aria-label", `Increase ${row.cardName} quantity`);
	increment.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void onAdjust(row.key, 1);
	});

	return cell;
}

function renderCollectionRows(
	tableBody: HTMLElement,
	rows: CollectionRow[],
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onAdjust: (key: string, delta: number) => Promise<void>,
	onRetry: (cardName: string) => Promise<void>
): void {
	let currentSection = "";

	for (const row of rows) {
		if (row.section !== currentSection) {
			currentSection = row.section;
			const sectionRow = tableBody.createEl("tr", { cls: "mtg-collection-section-row" });
			const sectionCell = sectionRow.createEl("td", {
				text: currentSection,
				cls: "mtg-collection-section-cell",
			});
			sectionCell.colSpan = 4;
		}

		const tr = tableBody.createEl("tr", { cls: "mtg-collection-row" });
		tr.appendChild(createQuantityCell(row, onAdjust));
		tr.appendChild(createCollectionCardCell(row, cache, getSettings, popover, onRetry));
		const colorCell = tr.createEl("td", { cls: "mtg-collection-color" });
		colorCell.appendChild(createColorIdentityElement(row.colorIdentity));
		tr.createEl("td", { text: row.priceText, cls: "mtg-collection-price" });
	}
}

export async function renderCollectionTable(
	options: RenderCollectionTableOptions
): Promise<void> {
	const { containerEl, source, cache, getSettings, popover, onUpdateSource, onActivateEditor } = options;
	containerEl.empty();
	containerEl.addClass("mtg-collection-block");

	const parsed = parseCollectionList(source);
	if (parsed.cards.length === 0) {
		containerEl.createEl("p", {
			text: "No collection cards found in this block.",
			cls: "mtg-card-popover-message",
		});
		return;
	}

	const loadingEl = containerEl.createEl("p", {
		text: "Loading collection data…",
		cls: "mtg-card-popover-message",
	});

	const rows = await mapCollectionRows(parsed.cards, cache);
	if (!loadingEl.isConnected) {
		return;
	}

	containerEl.empty();
	containerEl.removeClass("is-updating");

	let isUpdating = false;
	const onAdjust = async (key: string, delta: number): Promise<void> => {
		if (isUpdating) return;

		isUpdating = true;
		containerEl.addClass("is-updating");
		try {
			const nextRows = adjustRows(rows, key, delta, getSettings().removeCollectionLineAtZero);
			await onUpdateSource(buildCollectionSource(nextRows));
		} finally {
			containerEl.removeClass("is-updating");
			isUpdating = false;
		}
	};

	const onRetry = async (cardName: string): Promise<void> => {
		if (isUpdating) return;

		isUpdating = true;
		containerEl.addClass("is-updating");
		try {
			await cache.evictCardLookup(cardName);
			await renderCollectionTable(options);
		} finally {
			containerEl.removeClass("is-updating");
			isUpdating = false;
		}
	};

	if (onActivateEditor) {
		containerEl.addEventListener("click", (event) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest("button, .mtg-card-ref, details, summary, a, input, select")
			) {
				return;
			}
			onActivateEditor();
		});
	}

	const table = containerEl.createEl("table", { cls: "mtg-collection-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Color" });
	headRow.createEl("th", { text: "Current price" });

	const tbody = table.createEl("tbody");
	renderCollectionRows(tbody, rows, cache, getSettings, popover, onAdjust, onRetry);
}
