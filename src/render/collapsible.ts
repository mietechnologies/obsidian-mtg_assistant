export interface CollapsibleBlock {
	bodyEl: HTMLElement;
	setTitle(title: string): void;
	setMeta(meta: string | undefined): void;
}

export interface CollapsibleSection {
	rowEl: HTMLTableRowElement;
	cellEl: HTMLTableCellElement;
	addRow(row: HTMLTableRowElement): void;
}

export function createCollapsibleBlock(
	containerEl: HTMLElement,
	title: string,
	collapsedByDefault: boolean,
	meta?: string
): CollapsibleBlock {
	const titleButton = containerEl.createEl("button", { cls: "mtg-block-title-button" });
	titleButton.type = "button";
	const titleEl = titleButton.createEl("span", {
		text: title,
		cls: "mtg-block-title-text",
	});
	const metaEl = titleButton.createEl("span", {
		cls: "mtg-block-title-meta",
	});
	const bodyEl = containerEl.createEl("div", { cls: "mtg-block-body" });
	let collapsed = collapsedByDefault;

	const render = (): void => {
		titleButton.setAttribute("aria-expanded", collapsed ? "false" : "true");
		metaEl.textContent = meta ?? "";
		metaEl.toggleClass("is-empty", !meta);
		bodyEl.toggleClass("is-collapsed", collapsed);
	};

	titleButton.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		collapsed = !collapsed;
		render();
	});
	render();

	return {
		bodyEl,
		setTitle(nextTitle: string): void {
			titleEl.textContent = nextTitle;
		},
		setMeta(nextMeta: string | undefined): void {
			meta = nextMeta;
			render();
		},
	};
}

export function createCollapsibleSectionRow(
	tableBody: HTMLElement,
	title: string,
	colSpan: number,
	cellClassName: string,
	collapsedByDefault: boolean
): CollapsibleSection {
	const sectionRows: HTMLTableRowElement[] = [];
	const rowEl = tableBody.createEl("tr", { cls: "mtg-section-row" });
	const cellEl = rowEl.createEl("td", { cls: cellClassName });
	cellEl.colSpan = colSpan;
	cellEl.addClass("mtg-section-toggle");
	cellEl.tabIndex = 0;
	rowEl.setAttribute("role", "button");

	cellEl.createEl("span", { text: title, cls: "mtg-section-toggle-text" });
	let collapsed = collapsedByDefault;

	const render = (): void => {
		rowEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
		cellEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
		for (const row of sectionRows) {
			row.toggleClass("is-collapsed", collapsed);
		}
	};

	const toggle = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
		collapsed = !collapsed;
		render();
	};

	rowEl.addEventListener("click", toggle);
	cellEl.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		toggle(event);
	});
	render();

	return {
		rowEl,
		cellEl,
		addRow(row: HTMLTableRowElement): void {
			sectionRows.push(row);
			row.toggleClass("is-collapsed", collapsed);
		},
	};
}
