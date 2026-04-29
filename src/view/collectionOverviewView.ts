import { ItemView, WorkspaceLeaf } from "obsidian";
import { CardPreviewResult, CardCache } from "../cache/cardCache";
import { CollectionOverview, CollectionRow, loadCollectionOverview } from "../collection/collectionIndex";
import { createColorIdentityElement } from "../render/colorIdentity";
import { MTGSettings } from "../settings";

export const COLLECTION_OVERVIEW_VIEW_TYPE = "mtg-collection-overview";

interface ResolvedCollectionRow extends CollectionRow {
	resolvedName: string;
	colorIdentity: string[];
	unitPrice: number | null;
	totalPrice: number | null;
}

interface CollectionSectionRollup {
	section: string;
	quantity: number;
	value: number;
}

function getUnitUsdPrice(result: CardPreviewResult): number | null {
	const usd = result.card?.prices?.usd;
	if (!usd) return null;

	const value = Number.parseFloat(usd);
	return Number.isFinite(value) ? value : null;
}

function formatUsd(value: number | null): string {
	return value === null ? "N/A" : `$${value.toFixed(2)}`;
}

function createStatCard(containerEl: HTMLElement, label: string, value: string): void {
	const card = containerEl.createEl("div", { cls: "mtg-overview-stat" });
	card.createEl("div", { text: value, cls: "mtg-overview-stat-value" });
	card.createEl("div", { text: label, cls: "mtg-overview-stat-label" });
}

async function resolveCollectionRows(
	rows: CollectionRow[],
	cache: CardCache,
	concurrency = 4
): Promise<ResolvedCollectionRow[]> {
	const resolvedRows: ResolvedCollectionRow[] = [];
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		while (nextIndex < rows.length) {
			const currentIndex = nextIndex++;
			const row = rows[currentIndex];
			if (!row) continue;

			const resolved = await cache.resolveCard(row.cardName);
			const unitPrice = getUnitUsdPrice(resolved);
			resolvedRows[currentIndex] = {
				...row,
				resolvedName: resolved.cardName,
				colorIdentity: resolved.card?.colorIdentity ?? [],
				unitPrice,
				totalPrice: unitPrice === null ? null : unitPrice * row.quantity,
			};
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(concurrency, Math.max(rows.length, 1)) }, () => worker())
	);
	return resolvedRows;
}

function renderSectionRollups(containerEl: HTMLElement, rows: ResolvedCollectionRow[]): void {
	const sectionMap = new Map<string, CollectionSectionRollup>();
	for (const row of rows) {
		const section = row.section ?? "Other";
		const current = sectionMap.get(section) ?? {
			section,
			quantity: 0,
			value: 0,
		};
		current.quantity += row.quantity;
		if (row.totalPrice !== null) {
			current.value += row.totalPrice;
		}
		sectionMap.set(section, current);
	}

	const panel = containerEl.createEl("section", { cls: "mtg-overview-panel" });
	panel.createEl("h4", { text: "Sections", cls: "mtg-overview-panel-heading" });

	const table = panel.createEl("table", { cls: "mtg-overview-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Section" });
	headRow.createEl("th", { text: "Cards" });
	headRow.createEl("th", { text: "Value" });

	const tbody = table.createEl("tbody");
	for (const rollup of Array.from(sectionMap.values()).sort((left, right) => {
		if (right.quantity !== left.quantity) {
			return right.quantity - left.quantity;
		}
		return left.section.localeCompare(right.section);
	})) {
		const tr = tbody.createEl("tr");
		tr.createEl("td", { text: rollup.section });
		tr.createEl("td", { text: String(rollup.quantity) });
		tr.createEl("td", { text: formatUsd(rollup.value) });
	}
}

function renderHoldingsTable(containerEl: HTMLElement, rows: ResolvedCollectionRow[]): void {
	const panel = containerEl.createEl("section", { cls: "mtg-overview-panel" });
	panel.createEl("h4", { text: "Top holdings", cls: "mtg-overview-panel-heading" });

	const table = panel.createEl("table", { cls: "mtg-overview-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Color" });
	headRow.createEl("th", { text: "Unit" });
	headRow.createEl("th", { text: "Total" });

	const tbody = table.createEl("tbody");
	for (const row of rows
		.slice()
		.sort((left, right) => {
			if (right.quantity !== left.quantity) {
				return right.quantity - left.quantity;
			}
			return left.resolvedName.localeCompare(right.resolvedName);
		})
		.slice(0, 20)) {
		const tr = tbody.createEl("tr");
		tr.createEl("td", { text: String(row.quantity) });
		tr.createEl("td", { text: row.resolvedName });
		const colorCell = tr.createEl("td");
		colorCell.appendChild(createColorIdentityElement(row.colorIdentity));
		tr.createEl("td", { text: formatUsd(row.unitPrice) });
		tr.createEl("td", { text: formatUsd(row.totalPrice) });
	}
}

export class CollectionOverviewView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly cache: CardCache,
		private readonly getSettings: () => MTGSettings
	) {
		super(leaf);
	}

	getViewType(): string {
		return COLLECTION_OVERVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Collection Overview";
	}

	getIcon(): string {
		return "gallery-vertical";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mtg-overview-view");

		contentEl.createEl("h3", {
			text: "Collection overview",
			cls: "mtg-overview-title",
		});

		const loadingEl = contentEl.createEl("p", {
			text: "Loading collection overview…",
			cls: "mtg-card-popover-message",
		});

		const overview = await loadCollectionOverview(this.app, this.getSettings());
		const resolvedRows = await resolveCollectionRows(overview.rows, this.cache);
		if (!loadingEl.isConnected) {
			return;
		}

		contentEl.empty();
		contentEl.addClass("mtg-overview-view");
		contentEl.createEl("h3", {
			text: "Collection overview",
			cls: "mtg-overview-title",
		});

		if (overview.rows.length === 0) {
			contentEl.createEl("p", {
				text: "No collection cards found in the configured collection folder.",
				cls: "mtg-card-popover-message",
			});
			return;
		}

		const sourceMeta = contentEl.createEl("p", {
			cls: "mtg-overview-meta",
			text: `Using ${overview.sourceBlockCount} collection block${overview.sourceBlockCount === 1 ? "" : "s"} across ${overview.sourceFileCount} note${overview.sourceFileCount === 1 ? "" : "s"}.`,
		});
		sourceMeta.setAttribute("data-folder", this.getSettings().collectionFolder);

		const stats = contentEl.createEl("div", { cls: "mtg-overview-stats" });
		createStatCard(stats, "Total cards", String(overview.totalQuantity));
		createStatCard(stats, "Unique cards", String(overview.uniqueCardCount));
		const totalValue = resolvedRows.reduce((sum, row) => sum + (row.totalPrice ?? 0), 0);
		createStatCard(stats, "Estimated value", formatUsd(totalValue));

		const grid = contentEl.createEl("div", { cls: "mtg-overview-grid" });
		renderHoldingsTable(grid, resolvedRows);
		renderSectionRollups(grid, resolvedRows);
	}
}
