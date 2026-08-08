import { App, setIcon } from "obsidian";
import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { ParsedDeckCard, parseCollectionList } from "../parser/deckParser";
import { MTGSettings } from "../settings";
import { attachHoverEvents, MtgPopover, renderOwnershipPopoverSection } from "./cardImageRenderer";
import { createColorIdentityElement } from "./colorIdentity";
import { inferSection, sectionSortKey, titleCaseSection } from "./cardSections";
import { createRateLimitWarning } from "./lookupWarning";
import {
	CardTransferModal,
	CollectionMassTransferModal,
	createTransferButton,
	TransferSourceContext,
} from "../transfer/cardTransfer";
import { loadOwnershipRefsForCards, OwnershipBlockRef } from "../ownership/cardOwnership";
import { createCollapsibleBlock, createCollapsibleSectionRow } from "./collapsible";

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
	title?: string;
	stateKey?: string;
	transfer?: {
		app: App;
		source: TransferSourceContext;
	};
}

const COLLECTION_RENDER_TOKEN_ATTR = "data-mtg-collection-render-token";
const COLLECTION_SELECTION_STATE = new Map<string, Set<string>>();

function normalizeCardKey(cardName: string): string {
	return cardName.trim().toLowerCase();
}

function getCollectionSelectionStateKey(
	stateKey: string | undefined,
	source: TransferSourceContext | undefined
): string | null {
	if (stateKey) {
		return stateKey;
	}
	if (!source) {
		return null;
	}
	return `${source.path}:${source.lineStart}:collection`;
}

function getCollectionSelectionState(stateKey: string | null): Set<string> {
	if (!stateKey) {
		return new Set();
	}

	const existing = COLLECTION_SELECTION_STATE.get(stateKey);
	if (existing) {
		return existing;
	}

	const next = new Set<string>();
	COLLECTION_SELECTION_STATE.set(stateKey, next);
	return next;
}

function getCollectionSelectionKey(row: CollectionRow): string {
	return normalizeCardKey(row.lookupName);
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
	onProgress?: (completed: number, total: number) => void,
): Promise<CollectionRow[]> {
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
			const inferredSection = inferSection(resolved.card?.typeLine);
			const section =
				inferredSection !== "Other"
					? inferredSection
					: card.section
						? titleCaseSection(card.section)
						: inferredSection;
			const unitPrice = getUnitUsdPrice(resolved);

			return {
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
		})
	);
}

function createInitialCollectionRows(cards: ParsedDeckCard[]): CollectionRow[] {
	return sortRows(
		cards.map((card) => ({
			key: normalizeCardKey(card.cardName),
			lookupName: card.cardName,
			quantity: card.quantity,
			cardName: card.cardName,
			section: card.section ? titleCaseSection(card.section) : "Other",
			colorIdentity: [],
			priceText: "Loading…",
			priceValue: null,
		}))
	);
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
	app: App | null,
	row: CollectionRow,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover,
	onRetry: (cardName: string) => Promise<void>,
	ownershipRefs: OwnershipBlockRef[] = []
): HTMLTableCellElement {
	const cell = createEl("td");
	const span = createEl("span");
	span.className = "mtg-card-ref";
	span.textContent = row.cardName;
	span.tabIndex = 0;
	span.setAttribute("role", "button");
	span.setAttribute("aria-label", `Show Magic card preview for ${row.cardName}`);
	attachHoverEvents(
		span,
		row.cardName,
		cache,
		getSettings,
		popover,
		app ? renderOwnershipPopoverSection(app, ownershipRefs, "Also owned in") : undefined
	);
	cell.appendChild(span);
	if (row.rateLimitedMessage) {
		cell.appendChild(createRateLimitWarning(row.rateLimitedMessage, () => onRetry(row.lookupName)));
	}
	return cell;
}

function createQuantityCell(
	row: CollectionRow,
	onAdjust: (key: string, delta: number) => Promise<void>,
	onTransferAway: ((row: CollectionRow) => void) | null
): HTMLTableCellElement {
	const cell = createEl("td");
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
		if (onTransferAway && row.quantity > 0) {
			onTransferAway(row);
			return;
		}
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

function createSelectionCell(
	row: CollectionRow,
	selectedKeys: Set<string>,
	onSelectionChange: (key: string, selected: boolean) => void
): HTMLTableCellElement {
	const cell = createEl("td");
	cell.className = "mtg-collection-select";
	const checkbox = cell.createEl("input");
	checkbox.type = "checkbox";
	checkbox.checked = selectedKeys.has(getCollectionSelectionKey(row));
	checkbox.disabled = row.quantity <= 0;
	checkbox.setAttribute("aria-label", `Select ${row.cardName} for mass transfer`);
	checkbox.addEventListener("click", (event) => {
		event.stopPropagation();
	});
	checkbox.addEventListener("change", () => {
		onSelectionChange(getCollectionSelectionKey(row), checkbox.checked);
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
	onRetry: (cardName: string) => Promise<void>,
	transfer: RenderCollectionTableOptions["transfer"],
	ownershipRefsByKey: Map<string, OwnershipBlockRef[]>,
	selectedKeys: Set<string>,
	onSelectionChange: (key: string, selected: boolean) => void,
	sectionsCollapsedByDefault: boolean,
	stateKey?: string
): void {
	let currentSection = "";
	let currentSectionRows: ReturnType<typeof createCollapsibleSectionRow> | null = null;
	const onTransferAway = transfer
		? (row: CollectionRow): void => {
			new CardTransferModal(
				transfer.app,
				getSettings(),
				{
					source: transfer.source,
					cardName: row.cardName,
					sourceCardName: row.lookupName,
					availableQuantity: row.quantity,
				},
				{ allowRemove: true, allowAddNew: true }
			).open();
		}
		: null;

	for (const row of rows) {
		if (row.section !== currentSection) {
			currentSection = row.section;
			currentSectionRows = createCollapsibleSectionRow(
				tableBody,
				currentSection,
				transfer ? 6 : 4,
				"mtg-collection-section-cell",
				sectionsCollapsedByDefault,
				stateKey ? `${stateKey}:section:${currentSection.trim().toLowerCase()}` : undefined
			);
			currentSectionRows.rowEl.addClass("mtg-collection-section-row");
		}

		const tr = tableBody.createEl("tr", { cls: "mtg-collection-row" });
		currentSectionRows?.addRow(tr);
		if (transfer) {
			tr.appendChild(createSelectionCell(row, selectedKeys, onSelectionChange));
		}
		tr.appendChild(createQuantityCell(row, onAdjust, onTransferAway));
		tr.appendChild(createCollectionCardCell(
			transfer?.app ?? null,
			row,
			cache,
			getSettings,
			popover,
			onRetry,
			ownershipRefsByKey.get(normalizeCardKey(row.lookupName)) ?? []
		));
		const colorCell = tr.createEl("td", { cls: "mtg-collection-color" });
		colorCell.appendChild(createColorIdentityElement(row.colorIdentity));
		tr.createEl("td", { text: row.priceText, cls: "mtg-collection-price" });
		if (transfer) {
			const actionCell = tr.createEl("td", { cls: "mtg-transfer-cell" });
			actionCell.appendChild(
				createTransferButton(transfer.app, getSettings(), {
					source: transfer.source,
					cardName: row.cardName,
					sourceCardName: row.lookupName,
					availableQuantity: row.quantity,
				})
			);
		}
	}
}

export async function renderCollectionTable(
	options: RenderCollectionTableOptions
): Promise<void> {
	const {
		containerEl,
		source,
		cache,
		getSettings,
		popover,
		onUpdateSource,
		onActivateEditor,
		title,
		stateKey,
		transfer,
	} = options;
	containerEl.empty();
	containerEl.addClass("mtg-collection-block");

	const parsed = parseCollectionList(source);
	const settings = getSettings();
	const block = createCollapsibleBlock(
		containerEl,
		parsed.name ?? title ?? "Collection",
		{
			collapsedByDefault: settings.collectionListsCollapsedByDefault,
			stateKey,
		}
	);
	const bodyEl = block.bodyEl;
	if (parsed.cards.length === 0) {
		bodyEl.createEl("p", {
			text: "No collection cards found in this block.",
			cls: "mtg-card-popover-message",
		});
		return;
	}

	containerEl.removeClass("is-updating");
	const renderToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	containerEl.setAttribute(COLLECTION_RENDER_TOKEN_ATTR, renderToken);
	let rows = createInitialCollectionRows(parsed.cards);
	const selectionStateKey = getCollectionSelectionStateKey(stateKey, transfer?.source);
	const selectedKeys = getCollectionSelectionState(selectionStateKey);
	let massTransferButton: HTMLButtonElement | null = null;
	let selectAllCheckbox: HTMLInputElement | null = null;
	const ownershipRefsByKey = transfer
		? await loadOwnershipRefsForCards(
			transfer.app,
			getSettings(),
			parsed.cards.map((card) => card.cardName),
			{
				path: transfer.source.path,
				lineStart: transfer.source.lineStart,
				language: "collection",
			}
		)
		: new Map<string, OwnershipBlockRef[]>();

	const getSelectedTransferCards = (): Array<{
		cardName: string;
		sourceCardName: string;
		quantity: number;
		unitPrice: number | null;
		colorIdentity: string[];
	}> => rows
		.filter((row) => selectedKeys.has(getCollectionSelectionKey(row)) && row.quantity > 0)
		.map((row) => ({
			cardName: row.cardName,
			sourceCardName: row.lookupName,
			quantity: row.quantity,
			unitPrice: row.priceValue,
			colorIdentity: row.colorIdentity,
		}));

	const updateMassTransferState = (): void => {
		const selectedCount = getSelectedTransferCards().length;
		if (massTransferButton) {
			massTransferButton.disabled = selectedCount === 0;
			massTransferButton.setAttribute(
				"aria-label",
				selectedCount === 0
					? "Select cards to transfer"
					: `Transfer ${selectedCount} selected card${selectedCount === 1 ? "" : "s"}`
			);
		}

		if (selectAllCheckbox) {
			const selectableRows = rows.filter((row) => row.quantity > 0);
			const selectedRows = selectableRows.filter((row) =>
				selectedKeys.has(getCollectionSelectionKey(row))
			);
			selectAllCheckbox.checked = selectableRows.length > 0 && selectedRows.length === selectableRows.length;
			selectAllCheckbox.indeterminate =
				selectedRows.length > 0 && selectedRows.length < selectableRows.length;
			selectAllCheckbox.disabled = selectableRows.length === 0;
		}
	};

	const onSelectionChange = (key: string, selected: boolean): void => {
		if (selected) {
			selectedKeys.add(key);
		} else {
			selectedKeys.delete(key);
		}
		updateMassTransferState();
	};

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

	const loadingEl = bodyEl.createEl("p", {
		text: "Loading collection metadata 0/" + String(parsed.cards.length) + "…",
		cls: "mtg-card-popover-message",
	});

	if (transfer) {
		massTransferButton = block.actionsEl.createEl("button", { cls: "mtg-block-action-button" });
		massTransferButton.type = "button";
		massTransferButton.title = "Transfer selected cards";
		massTransferButton.disabled = true;
		setIcon(massTransferButton, "send");
		massTransferButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			const selectedCards = getSelectedTransferCards();
			if (selectedCards.length === 0) {
				return;
			}
			new CollectionMassTransferModal(
				transfer.app,
				getSettings(),
				transfer.source,
				selectedCards
			).open();
		});
	}

	if (onActivateEditor) {
		bodyEl.addEventListener("click", (event) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest("button, .mtg-section-toggle, .mtg-card-ref, .mtg-collection-select, details, summary, a, input, select")
			) {
				return;
			}
			onActivateEditor();
		});
	}

	const table = bodyEl.createEl("table", { cls: "mtg-collection-table" });
	const thead = table.createEl("thead");
	const headRow = thead.createEl("tr");
	if (transfer) {
		const selectHeader = headRow.createEl("th", { cls: "mtg-collection-select" });
		selectAllCheckbox = selectHeader.createEl("input");
		selectAllCheckbox.type = "checkbox";
		selectAllCheckbox.setAttribute("aria-label", "Select all collection cards for mass transfer");
		selectAllCheckbox.addEventListener("click", (event) => {
			event.stopPropagation();
		});
		selectAllCheckbox.addEventListener("change", () => {
			const selected = selectAllCheckbox?.checked ?? false;
			for (const row of rows) {
				if (row.quantity <= 0) {
					selectedKeys.delete(getCollectionSelectionKey(row));
					continue;
				}
				if (selected) {
					selectedKeys.add(getCollectionSelectionKey(row));
				} else {
					selectedKeys.delete(getCollectionSelectionKey(row));
				}
			}
			tbody.empty();
			renderCollectionRows(
				tbody,
				rows,
				cache,
				getSettings,
				popover,
				onAdjust,
				onRetry,
				transfer,
				ownershipRefsByKey,
				selectedKeys,
				onSelectionChange,
				getSettings().collectionSectionsCollapsedByDefault,
				stateKey
			);
			updateMassTransferState();
		});
	}
	headRow.createEl("th", { text: "Qty" });
	headRow.createEl("th", { text: "Card" });
	headRow.createEl("th", { text: "Color" });
	headRow.createEl("th", { text: "Current price", cls: "mtg-collection-price" });
	if (transfer) {
		headRow.createEl("th", { cls: "mtg-transfer-header" });
	}

	const tbody = table.createEl("tbody");
	renderCollectionRows(
		tbody,
		rows,
		cache,
		getSettings,
		popover,
		onAdjust,
		onRetry,
		transfer,
		ownershipRefsByKey,
		selectedKeys,
		onSelectionChange,
		settings.collectionSectionsCollapsedByDefault,
		stateKey
	);
	updateMassTransferState();

	void mapCollectionRows(parsed.cards, cache, (completed, total) => {
		if (
			!loadingEl.isConnected ||
			containerEl.getAttribute(COLLECTION_RENDER_TOKEN_ATTR) !== renderToken
		) {
			return;
		}

		loadingEl.textContent =
			completed >= total
				? "Finalizing collection metadata…"
				: `Loading collection metadata ${completed}/${total}…`;
	}).then((resolvedRows) => {
		if (
			!containerEl.isConnected ||
			containerEl.getAttribute(COLLECTION_RENDER_TOKEN_ATTR) !== renderToken
		) {
			return;
		}

		rows = resolvedRows;
		for (const selectedKey of Array.from(selectedKeys)) {
			if (!rows.some((row) => getCollectionSelectionKey(row) === selectedKey && row.quantity > 0)) {
				selectedKeys.delete(selectedKey);
			}
		}
		loadingEl.remove();
		tbody.empty();
		renderCollectionRows(
			tbody,
			rows,
			cache,
			getSettings,
			popover,
			onAdjust,
			onRetry,
			transfer,
			ownershipRefsByKey,
			selectedKeys,
			onSelectionChange,
			getSettings().collectionSectionsCollapsedByDefault,
			stateKey
		);
		updateMassTransferState();
	});
}
