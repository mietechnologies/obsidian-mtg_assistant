import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { CardPreviewResult, CardCache } from "../cache/cardCache";
import {
	CollectionRow,
	CollectionSourceRef,
	loadCollectionOverview,
} from "../collection/collectionIndex";
import { sectionSortKey, titleCaseSection } from "../render/cardSections";
import { attachHoverEvents, MtgPopover } from "../render/cardImageRenderer";
import { createManaCostElement } from "../render/manaCost";
import { parseCollectionList } from "../parser/deckParser";
import { MTGSettings } from "../settings";

export const COLLECTION_OVERVIEW_VIEW_TYPE = "mtg-collection-overview";

interface ResolvedCollectionRow extends CollectionRow {
	resolvedName: string;
	manaCosts?: string[];
	manaValue?: number;
	typeLine?: string;
	displayType: string;
	keywords: string[];
	oracleTexts: string[];
	typeCategories: string[];
	searchText: string;
	unitPrice: number | null;
	totalPrice: number | null;
}

type HoldingsSort =
	| "mana-value-asc"
	| "quantity-desc"
	| "name-asc"
	| "type-asc"
	| "collection-asc"
	| "unit-price-desc"
	| "value-desc";

function getUnitUsdPrice(result: CardPreviewResult): number | null {
	const usd = result.card?.prices?.usd;
	if (!usd) return null;

	const value = Number.parseFloat(usd);
	return Number.isFinite(value) ? value : null;
}

function formatUsd(value: number | null): string {
	return value === null ? "N/A" : `$${value.toFixed(2)}`;
}

interface EditableCollectionRow {
	key: string;
	cardName: string;
	quantity: number;
	section?: string;
}

function createStatCard(containerEl: HTMLElement, label: string, value: string): void {
	const card = containerEl.createEl("div", { cls: "mtg-overview-stat" });
	card.createEl("div", { text: value, cls: "mtg-overview-stat-value" });
	card.createEl("div", { text: label, cls: "mtg-overview-stat-label" });
}

function buildCollectionBlockText(language: string, source: string): string {
	return `\`\`\`${language}\n${source}\n\`\`\``;
}

function buildEditableRows(source: string): EditableCollectionRow[] {
	return parseCollectionList(source).cards.map((card) => ({
		key: card.cardName.trim().toLowerCase(),
		cardName: card.cardName,
		quantity: card.quantity,
		section: card.section ? titleCaseSection(card.section) : undefined,
	}));
}

function sortEditableRows(rows: EditableCollectionRow[]): EditableCollectionRow[] {
	return [...rows].sort((left, right) => {
		const leftSection = left.section ?? "Other";
		const rightSection = right.section ?? "Other";
		const sectionDelta = sectionSortKey(leftSection) - sectionSortKey(rightSection);
		if (sectionDelta !== 0) {
			return sectionDelta;
		}

		const sectionNameDelta = leftSection.localeCompare(rightSection);
		if (sectionNameDelta !== 0) {
			return sectionNameDelta;
		}

		return left.cardName.localeCompare(right.cardName);
	});
}

function buildCollectionSource(rows: EditableCollectionRow[]): string {
	const groupedRows = new Map<string, EditableCollectionRow[]>();

	for (const row of sortEditableRows(rows)) {
		const section = row.section ?? "Other";
		const sectionRows = groupedRows.get(section);
		if (sectionRows) {
			sectionRows.push(row);
			continue;
		}
		groupedRows.set(section, [row]);
	}

	return Array.from(groupedRows.entries())
		.map(([section, sectionRows]) => {
			const lines = [`- ${section}:`];
			for (const row of sectionRows) {
				lines.push(`${row.quantity} ${row.cardName}`);
			}
			return lines.join("\n");
		})
		.join("\n\n");
}

function adjustCollectionRows(
	rows: EditableCollectionRow[],
	targetKey: string,
	delta: number,
	removeAtZero: boolean
): EditableCollectionRow[] {
	const nextRows: EditableCollectionRow[] = [];

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

function chooseSourceRef(row: ResolvedCollectionRow, delta: number): CollectionSourceRef | null {
	if (row.sourceRefs.length === 0) {
		return null;
	}

	if (delta > 0) {
		return row.sourceRefs[0] ?? null;
	}

	return (
		row.sourceRefs
			.slice()
			.sort((left, right) => right.quantity - left.quantity)[0] ?? null
	);
}

function createQuantityCell(
	view: CollectionOverviewView,
	row: ResolvedCollectionRow
): HTMLTableCellElement {
	const cell = document.createElement("td");
	cell.className = "mtg-collection-qty mtg-overview-qty-cell";

	const wrapper = cell.createEl("div", { cls: "mtg-collection-qty-controls" });
	const decrement = wrapper.createEl("button", {
		text: "−",
		cls: "mtg-collection-stepper",
	});
	decrement.type = "button";
	decrement.setAttribute("aria-label", `Decrease ${row.resolvedName} quantity`);
	decrement.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void view.adjustQuantity(row, -1);
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
	increment.setAttribute("aria-label", `Increase ${row.resolvedName} quantity`);
	increment.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		void view.adjustQuantity(row, 1);
	});

	return cell;
}

function extractTypeCategories(typeLine: string | undefined): string[] {
	const normalized = typeLine?.toLowerCase() ?? "";
	const categories = [
		["Creature", normalized.includes("creature")],
		["Land", normalized.includes("land")],
		["Instant", normalized.includes("instant")],
		["Sorcery", normalized.includes("sorcery")],
		["Artifact", normalized.includes("artifact")],
		["Enchantment", normalized.includes("enchantment")],
		["Planeswalker", normalized.includes("planeswalker")],
		["Battle", normalized.includes("battle")],
	].filter(([, included]) => included).map(([label]) => label as string);

	return categories.length > 0 ? categories : ["Other"];
}

function normalizeDisplayType(typeLine: string | undefined): string {
	if (!typeLine) {
		return "—";
	}

	const normalizeFace = (faceType: string): string => {
		const leftSide = faceType.split("—")[0]?.split("-")[0]?.trim() ?? faceType.trim();
		const parts = leftSide.split(/\s+/);
		const supertypes = new Set(["Basic", "Legendary"]);
		const cardTypes = new Set([
			"Artifact",
			"Battle",
			"Creature",
			"Enchantment",
			"Instant",
			"Land",
			"Planeswalker",
			"Sorcery",
		]);
		const kept = parts.filter((part) => supertypes.has(part) || cardTypes.has(part));
		return kept.length > 0 ? kept.join(" ") : leftSide;
	};

	return typeLine
		.split(/\s*\/\/\s*/)
		.map((face) => normalizeFace(face))
		.join(" // ");
}

function sortHoldings(rows: ResolvedCollectionRow[], sortBy: HoldingsSort): ResolvedCollectionRow[] {
	switch (sortBy) {
		case "mana-value-asc":
			return rows.slice().sort((left, right) => {
				const leftValue =
					left.manaValue === 0
						? Number.POSITIVE_INFINITY - 1
						: (left.manaValue ?? Number.POSITIVE_INFINITY);
				const rightValue =
					right.manaValue === 0
						? Number.POSITIVE_INFINITY - 1
						: (right.manaValue ?? Number.POSITIVE_INFINITY);
				if (leftValue !== rightValue) {
					return leftValue - rightValue;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
		case "name-asc":
			return rows.slice().sort((left, right) => left.resolvedName.localeCompare(right.resolvedName));
		case "type-asc":
			return rows.slice().sort((left, right) => {
				const typeDelta = left.displayType.localeCompare(right.displayType);
				if (typeDelta !== 0) {
					return typeDelta;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
		case "collection-asc":
			return rows.slice().sort((left, right) => {
				const leftCollection = left.sourcePaths[0] ?? "";
				const rightCollection = right.sourcePaths[0] ?? "";
				const collectionDelta = leftCollection.localeCompare(rightCollection);
				if (collectionDelta !== 0) {
					return collectionDelta;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
		case "unit-price-desc":
			return rows.slice().sort((left, right) => {
				const leftValue = left.unitPrice ?? -1;
				const rightValue = right.unitPrice ?? -1;
				if (rightValue !== leftValue) {
					return rightValue - leftValue;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
		case "value-desc":
			return rows.slice().sort((left, right) => {
				const leftValue = left.totalPrice ?? -1;
				const rightValue = right.totalPrice ?? -1;
				if (rightValue !== leftValue) {
					return rightValue - leftValue;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
		case "quantity-desc":
		default:
			return rows.slice().sort((left, right) => {
				if (right.quantity !== left.quantity) {
					return right.quantity - left.quantity;
				}
				return left.resolvedName.localeCompare(right.resolvedName);
			});
	}
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
				manaCosts:
					resolved.card?.manaCosts ??
					(resolved.card?.manaCost ? [resolved.card.manaCost] : undefined),
				manaValue: resolved.card?.manaValue,
				typeLine: resolved.card?.typeLine,
				displayType: normalizeDisplayType(resolved.card?.typeLine),
				keywords: resolved.card?.keywords ?? [],
				oracleTexts: resolved.card?.oracleTexts ?? (resolved.card?.oracleText ? [resolved.card.oracleText] : []),
				typeCategories: extractTypeCategories(resolved.card?.typeLine),
				searchText: [
					resolved.cardName,
					resolved.card?.typeLine ?? "",
					...(resolved.card?.keywords ?? []),
					...(resolved.card?.oracleTexts ?? (resolved.card?.oracleText ? [resolved.card.oracleText] : [])),
				]
					.join(" ")
					.toLowerCase(),
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

function renderCollectionLink(view: CollectionOverviewView, containerEl: HTMLElement, row: ResolvedCollectionRow): void {
	const primaryPath = row.sourcePaths[0];
	if (!primaryPath) {
		containerEl.textContent = "—";
		return;
	}

	const file = view.app.vault.getAbstractFileByPath(primaryPath);
	const link = containerEl.createEl("a", {
		text: file instanceof TFile ? file.basename : primaryPath,
		cls: "internal-link",
		href: "#",
	});
	link.addEventListener("click", (event) => {
		event.preventDefault();
		void view.app.workspace.openLinkText(primaryPath, "", true);
	});

	if (row.sourcePaths.length > 1) {
		containerEl.createEl("span", {
			text: ` +${row.sourcePaths.length - 1}`,
			cls: "mtg-overview-link-count",
		});
	}
}

function renderHoldingsTable(
	view: CollectionOverviewView,
	containerEl: HTMLElement,
	rows: ResolvedCollectionRow[]
): void {
	const panel = containerEl.createEl("section", { cls: "mtg-overview-panel" });
	panel.createEl("h4", { text: "Collection cards", cls: "mtg-overview-panel-heading" });

	const table = panel.createEl("table", { cls: "mtg-overview-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Type" });
	headRow.createEl("th", { text: "Mana cost" });
	headRow.createEl("th", { text: "Collection" });
	headRow.createEl("th", { text: "Unit" });
	headRow.createEl("th", { text: "Total" });

	const tbody = table.createEl("tbody");
	for (const row of rows.slice(0, 50)) {
		const tr = tbody.createEl("tr", { cls: "mtg-collection-row" });
		tr.appendChild(createQuantityCell(view, row));
		const cardCell = tr.createEl("td");
		const cardSpan = cardCell.createEl("span", {
			text: row.resolvedName,
			cls: "mtg-card-ref",
		});
		cardSpan.tabIndex = 0;
		cardSpan.setAttribute("role", "button");
		cardSpan.setAttribute("aria-label", `Show Magic card preview for ${row.resolvedName}`);
		attachHoverEvents(cardSpan, row.resolvedName, view.cache, view.getSettingsAccessor, view.popover);
		tr.createEl("td", { text: row.displayType, cls: "mtg-overview-type-cell" });
		const manaCell = tr.createEl("td", { cls: "mtg-overview-mana-cell" });
		manaCell.appendChild(createManaCostElement(row.manaCosts));
		const collectionCell = tr.createEl("td");
		renderCollectionLink(view, collectionCell, row);
		tr.createEl("td", { text: formatUsd(row.unitPrice) });
		tr.createEl("td", { text: formatUsd(row.totalPrice) });
	}
}

export class CollectionOverviewView extends ItemView {
	private searchTerm = "";
	private typeFilter = "all";
	private holdingsSort: HoldingsSort = "mana-value-asc";

	constructor(
		leaf: WorkspaceLeaf,
		readonly cache: CardCache,
		readonly getSettingsAccessor: () => MTGSettings,
		readonly popover: MtgPopover
	) {
		super(leaf);
	}

	getViewType(): string {
		return COLLECTION_OVERVIEW_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Collection overview";
	}

	getIcon(): string {
		return "gallery-vertical";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
	}

	async adjustQuantity(row: ResolvedCollectionRow, delta: number): Promise<void> {
		const sourceRef = chooseSourceRef(row, delta);
		if (!sourceRef) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(sourceRef.sourcePath);
		if (!(file instanceof TFile)) {
			return;
		}

		const sectionLineCount = sourceRef.sectionText.split(/\r?\n/).length + 2;
		const currentRows = buildEditableRows(sourceRef.sectionText);
		const nextRows = adjustCollectionRows(
			currentRows,
			row.key,
			delta,
			this.getSettingsAccessor().removeCollectionLineAtZero
		);
		const nextSource = buildCollectionSource(nextRows);
		const nextBlock = buildCollectionBlockText(
			this.getSettingsAccessor().collectionCodeBlockLanguage,
			nextSource
		);
		await this.app.vault.process(file, (currentContent) => {
			const eol = currentContent.includes("\r\n") ? "\r\n" : "\n";
			const currentLines = currentContent.split(/\r?\n/);
			const nextLines = nextBlock.split("\n");

			currentLines.splice(sourceRef.lineStart, sectionLineCount, ...nextLines);
			return currentLines.join(eol);
		});
		await this.refresh();
	}

	private createControls(
		containerEl: HTMLElement,
		rows: ResolvedCollectionRow[],
		rerender: () => void
	): void {
		const controls = containerEl.createEl("div", { cls: "mtg-overview-controls" });

		const searchGroup = controls.createEl("label", { cls: "mtg-overview-control" });
		searchGroup.createEl("span", {
			text: "Search",
			cls: "mtg-overview-control-label",
		});
		const searchInput = searchGroup.createEl("input", {
			type: "search",
			cls: "mtg-overview-control-input",
		});
		searchInput.placeholder = "Filter card names";
		searchInput.value = this.searchTerm;
		searchInput.addEventListener("input", () => {
			this.searchTerm = searchInput.value.trim().toLowerCase();
			rerender();
		});

		const sectionGroup = controls.createEl("label", { cls: "mtg-overview-control" });
		sectionGroup.createEl("span", {
			text: "Type",
			cls: "mtg-overview-control-label",
		});
		const sectionSelect = sectionGroup.createEl("select", {
			cls: "mtg-overview-control-select",
		});
		const sections = [
			"all",
			...Array.from(new Set(rows.flatMap((row) => row.typeCategories))).sort(),
		];
		for (const section of sections) {
			const option = sectionSelect.createEl("option");
			option.value = section;
			option.textContent = section === "all" ? "All types" : section;
			option.selected = section === this.typeFilter;
		}
		sectionSelect.addEventListener("change", () => {
			this.typeFilter = sectionSelect.value;
			rerender();
		});

		const sortGroup = controls.createEl("label", { cls: "mtg-overview-control" });
		sortGroup.createEl("span", {
			text: "Sort",
			cls: "mtg-overview-control-label",
		});
		const sortSelect = sortGroup.createEl("select", {
			cls: "mtg-overview-control-select",
		});
		const sortOptions: Array<{ value: HoldingsSort; label: string }> = [
			{ value: "mana-value-asc", label: "Mana value" },
			{ value: "quantity-desc", label: "Quantity" },
			{ value: "type-asc", label: "Type" },
			{ value: "collection-asc", label: "Collection" },
			{ value: "unit-price-desc", label: "Price per card" },
			{ value: "value-desc", label: "Total value" },
			{ value: "name-asc", label: "Name" },
		];
		for (const { value, label } of sortOptions) {
			const option = sortSelect.createEl("option");
			option.value = value;
			option.textContent = label;
			option.selected = value === this.holdingsSort;
		}
		sortSelect.addEventListener("change", () => {
			this.holdingsSort = sortSelect.value as HoldingsSort;
			rerender();
		});
	}

	private getFilteredRows(rows: ResolvedCollectionRow[]): ResolvedCollectionRow[] {
		return rows.filter((row) => {
			if (
				this.typeFilter !== "all" &&
				!row.typeCategories.includes(this.typeFilter)
			) {
				return false;
			}

			if (!this.searchTerm) {
				return true;
			}

			return row.searchText.includes(this.searchTerm);
		});
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

		const overview = await loadCollectionOverview(this.app, this.getSettingsAccessor());
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
		sourceMeta.setAttribute("data-folder", this.getSettingsAccessor().collectionFolder);

		const stats = contentEl.createEl("div", { cls: "mtg-overview-stats" });
		createStatCard(stats, "Total cards", String(overview.totalQuantity));
		createStatCard(stats, "Unique cards", String(overview.uniqueCardCount));
		const totalValue = resolvedRows.reduce((sum, row) => sum + (row.totalPrice ?? 0), 0);
		createStatCard(stats, "Estimated value", formatUsd(totalValue));

		const body = contentEl.createEl("div", { cls: "mtg-overview-body" });
		let grid!: HTMLElement;
		const rerenderTables = (): void => {
			grid.empty();
			const filteredRows = this.getFilteredRows(resolvedRows);
			const sortedRows = sortHoldings(filteredRows, this.holdingsSort);
			renderHoldingsTable(this, grid, sortedRows);
		};

		this.createControls(body, resolvedRows, rerenderTables);
		grid = body.createEl("div", { cls: "mtg-overview-grid" });
		rerenderTables();
	}
}
