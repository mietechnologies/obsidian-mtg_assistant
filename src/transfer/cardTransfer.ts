import { App, Modal, Notice, setIcon, TFile } from "obsidian";
import { parseCollectionList, parseDeckList } from "../parser/deckParser";
import { MTGSettings } from "../settings";

export type TransferBlockLanguage = "deck" | "collection";

export interface TransferBlockRef {
	path: string;
	lineStart: number;
	language: TransferBlockLanguage;
	source: string;
}

export interface TransferSourceContext extends TransferBlockRef {
	onTransferComplete?: () => void | Promise<void>;
}

export interface TransferRowContext {
	source: TransferSourceContext;
	cardName: string;
	availableQuantity: number;
}

interface LocatedBlock {
	startLine: number;
	endLine: number;
	source: string;
}

interface TransferTargetBlock extends TransferBlockRef {
	label: string;
}

function normalizeCardKey(cardName: string): string {
	return cardName.trim().toLowerCase();
}

function buildBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

function countLineBreaks(text: string): number {
	let count = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) {
			count += 1;
		}
	}
	return count;
}

function getLanguageName(language: TransferBlockLanguage, settings: MTGSettings): string {
	return language === "deck"
		? settings.deckCodeBlockLanguage
		: settings.collectionCodeBlockLanguage;
}

function findClosingFenceLine(lines: string[], startLine: number): number {
	for (let index = startLine + 1; index < lines.length; index += 1) {
		if (/^```\s*$/.test(lines[index] ?? "")) {
			return index;
		}
	}
	return -1;
}

function locateBlock(
	content: string,
	lineStart: number,
	language: TransferBlockLanguage,
	settings: MTGSettings
): LocatedBlock | null {
	const lines = content.split(/\r?\n/);
	const openingLine = lines[lineStart]?.trim() ?? "";
	if (openingLine !== "```" + getLanguageName(language, settings)) {
		return null;
	}

	const endLine = findClosingFenceLine(lines, lineStart);
	if (endLine < 0) {
		return null;
	}

	return {
		startLine: lineStart,
		endLine,
		source: lines.slice(lineStart + 1, endLine).join("\n"),
	};
}

function replaceBlockSource(
	lines: string[],
	block: LocatedBlock,
	language: TransferBlockLanguage,
	settings: MTGSettings,
	nextSource: string
): void {
	const nextBlockLines = [
		"```" + getLanguageName(language, settings),
		...nextSource.split("\n"),
		"```",
	];
	lines.splice(block.startLine, block.endLine - block.startLine + 1, ...nextBlockLines);
}

function parseBlockName(block: TransferBlockRef, settings: MTGSettings): string | undefined {
	const parsed = block.language === "deck"
		? parseDeckList(block.source, settings.commanderMarker)
		: parseCollectionList(block.source);
	return parsed.name;
}

function buildTargetLabel(file: TFile, block: TransferBlockRef, settings: MTGSettings): string {
	const kind = block.language === "deck" ? "deck" : "collection";
	const line = block.lineStart + 1;
	const name = parseBlockName(block, settings);
	if (name) {
		return name;
	}

	return `${file.basename} - ${kind} at line ${line}`;
}

async function listTransferBlocks(
	app: App,
	settings: MTGSettings,
	source: TransferSourceContext
): Promise<TransferTargetBlock[]> {
	const files = app.vault.getMarkdownFiles();
	const blocks: TransferTargetBlock[] = [];
	const languages: Array<[TransferBlockLanguage, string]> = [
		["deck", settings.deckCodeBlockLanguage],
		["collection", settings.collectionCodeBlockLanguage],
	];

	for (const file of files) {
		const content = await app.vault.cachedRead(file);
		for (const [language, codeBlockLanguage] of languages) {
			const regex = buildBlockRegex(codeBlockLanguage);
			let lineStart = 0;
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = regex.exec(content)) !== null) {
				const blockStart = match.index + (match[1]?.length ?? 0);
				lineStart += countLineBreaks(content.slice(lastIndex, blockStart));
				const block: TransferBlockRef = {
					path: file.path,
					lineStart,
					language,
					source: match[2] ?? "",
				};
				lastIndex = blockStart;

				if (
					block.path === source.path &&
					block.lineStart === source.lineStart &&
					block.language === source.language
				) {
					continue;
				}

				blocks.push({
					...block,
					label: buildTargetLabel(file, block, settings),
				});
			}
		}
	}

	return blocks;
}

function parseHaveMetadata(cardText: string): { cardText: string; have?: number } {
	const match = /(?:\s+\|\s*have\s+|\s+\[have:\s*)(\d+)\s*\]?\s*$/i.exec(cardText);
	if (!match?.[1]) {
		return { cardText };
	}

	const have = Number.parseInt(match[1], 10);
	const cardTextWithoutMetadata = cardText.slice(0, match.index).trim();
	if (!Number.isFinite(have) || have < 0 || !cardTextWithoutMetadata) {
		return { cardText };
	}

	return {
		cardText: cardTextWithoutMetadata,
		have,
	};
}

function formatDeckCardText(cardText: string, have: number): string {
	return `${cardText} [have: ${have}]`;
}

function parseCardLine(line: string): {
	prefix: string;
	quantity: number;
	cardText: string;
	have?: number;
	suffix: string;
} | null {
	const match = /^(\s*(?:[-*+]\s+)?)(\d+)(\s*[xX]?\s+)(.+?)(\s*)$/.exec(line);
	if (!match?.[2] || !match[4]) {
		return null;
	}

	const quantity = Number.parseInt(match[2], 10);
	if (!Number.isFinite(quantity) || quantity < 0) {
		return null;
	}

	const metadata = parseHaveMetadata(match[4]);
	return {
		prefix: match[1] ?? "",
		quantity,
		cardText: metadata.cardText,
		have: metadata.have,
		suffix: match[5] ?? "",
	};
}

function updateCollectionSource(source: string, cardName: string, delta: number): string {
	const lines = source.split(/\r?\n/);
	const targetKey = normalizeCardKey(cardName);

	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseCardLine(lines[index] ?? "");
		if (!parsed || normalizeCardKey(parsed.cardText) !== targetKey) {
			continue;
		}

		const nextQuantity = parsed.quantity + delta;
		if (nextQuantity <= 0) {
			lines.splice(index, 1);
		} else {
			lines[index] = `${parsed.prefix}${nextQuantity} ${parsed.cardText}${parsed.suffix}`;
		}
		return lines.join("\n");
	}

	if (delta > 0) {
		const separator = lines.length > 0 && lines[lines.length - 1] !== "" ? "\n" : "";
		return `${source}${separator}${delta} ${cardName}`;
	}

	return source;
}

function updateDeckSource(source: string, cardName: string, delta: number): string {
	const lines = source.split(/\r?\n/);
	const targetKey = normalizeCardKey(cardName);

	for (let index = 0; index < lines.length; index += 1) {
		const parsed = parseCardLine(lines[index] ?? "");
		if (!parsed || normalizeCardKey(parsed.cardText) !== targetKey) {
			continue;
		}

		const nextHave = Math.max(0, (parsed.have ?? 0) + delta);
		lines[index] =
			`${parsed.prefix}${parsed.quantity} ${formatDeckCardText(parsed.cardText, nextHave)}${parsed.suffix}`;
		return lines.join("\n");
	}

	if (delta > 0) {
		const separator = lines.length > 0 && lines[lines.length - 1] !== "" ? "\n" : "";
		return `${source}${separator}${delta} ${cardName} [have: ${delta}]`;
	}

	return source;
}

function updateBlockSource(
	block: TransferBlockRef,
	cardName: string,
	delta: number
): string {
	return block.language === "deck"
		? updateDeckSource(block.source, cardName, delta)
		: updateCollectionSource(block.source, cardName, delta);
}

async function applyTransfer(
	app: App,
	settings: MTGSettings,
	source: TransferSourceContext,
	target: TransferTargetBlock,
	cardName: string,
	quantity: number
): Promise<void> {
	if (quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) {
		throw new Error("Transfer quantity must be positive.");
	}

	const sourceFile = app.vault.getAbstractFileByPath(source.path);
	const targetFile = app.vault.getAbstractFileByPath(target.path);
	if (!(sourceFile instanceof TFile) || !(targetFile instanceof TFile)) {
		throw new Error("Could not find the source or destination note.");
	}

	if (source.path === target.path) {
		await app.vault.process(sourceFile, (content) => {
			const eol = content.includes("\r\n") ? "\r\n" : "\n";
			const sourceBlock = locateBlock(content, source.lineStart, source.language, settings);
			const targetBlock = locateBlock(content, target.lineStart, target.language, settings);
			if (!sourceBlock || !targetBlock) {
				throw new Error("Could not locate the source or destination block.");
			}

			const nextSource = updateBlockSource(
				{ ...source, source: sourceBlock.source },
				cardName,
				-quantity
			);
			const nextTarget = updateBlockSource(
				{ ...target, source: targetBlock.source },
				cardName,
				quantity
			);
			const lines = content.split(/\r?\n/);
			const replacements = [
				{ block: sourceBlock, language: source.language, source: nextSource },
				{ block: targetBlock, language: target.language, source: nextTarget },
			].sort((left, right) => right.block.startLine - left.block.startLine);

			for (const replacement of replacements) {
				replaceBlockSource(
					lines,
					replacement.block,
					replacement.language,
					settings,
					replacement.source
				);
			}

			return lines.join(eol);
		});
		return;
	}

	await app.vault.process(sourceFile, (content) => {
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const block = locateBlock(content, source.lineStart, source.language, settings);
		if (!block) {
			throw new Error("Could not locate the source block.");
		}

		const lines = content.split(/\r?\n/);
		replaceBlockSource(
			lines,
			block,
			source.language,
			settings,
			updateBlockSource({ ...source, source: block.source }, cardName, -quantity)
		);
		return lines.join(eol);
	});

	await app.vault.process(targetFile, (content) => {
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const block = locateBlock(content, target.lineStart, target.language, settings);
		if (!block) {
			throw new Error("Could not locate the destination block.");
		}

		const lines = content.split(/\r?\n/);
		replaceBlockSource(
			lines,
			block,
			target.language,
			settings,
			updateBlockSource({ ...target, source: block.source }, cardName, quantity)
		);
		return lines.join(eol);
	});
}

export class CardTransferModal extends Modal {
	private targets: TransferTargetBlock[] = [];
	private blockSelect!: HTMLSelectElement;
	private quantityInput!: HTMLInputElement;
	private applyButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly settings: MTGSettings,
		private readonly row: TransferRowContext
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mtg-transfer-modal");
		contentEl.createEl("h3", { text: "Transfer card" });
		contentEl.createEl("p", {
			text: this.row.cardName,
			cls: "mtg-transfer-card-name",
		});

		const sourceMeta = contentEl.createEl("p", {
			cls: "mtg-transfer-meta",
			text: `From ${this.row.source.path}, line ${this.row.source.lineStart + 1}`,
		});
		sourceMeta.setAttribute("data-language", this.row.source.language);

		this.blockSelect = this.createLabeledSelect(contentEl, "Destination deck or collection");

		const quantityLabel = contentEl.createEl("label", { cls: "mtg-transfer-field" });
		quantityLabel.createEl("span", { text: "Quantity" });
		this.quantityInput = quantityLabel.createEl("input");
		this.quantityInput.type = "number";
		this.quantityInput.min = "1";
		this.quantityInput.max = String(this.row.availableQuantity);
		this.quantityInput.value = String(Math.min(1, this.row.availableQuantity));

		const actions = contentEl.createEl("div", { cls: "mtg-transfer-actions" });
		this.applyButton = actions.createEl("button", {
			text: "Apply",
			cls: "mod-cta",
		});
		this.applyButton.type = "button";
		this.applyButton.disabled = true;
		this.applyButton.addEventListener("click", () => {
			void this.apply();
		});

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.type = "button";
		cancelButton.addEventListener("click", () => this.close());

		this.blockSelect.addEventListener("change", () => this.updateApplyState());
		this.quantityInput.addEventListener("input", () => this.updateApplyState());

		void this.loadTargets();
	}

	private createLabeledSelect(containerEl: HTMLElement, label: string): HTMLSelectElement {
		const wrapper = containerEl.createEl("label", { cls: "mtg-transfer-field" });
		wrapper.createEl("span", { text: label });
		return wrapper.createEl("select");
	}

	private async loadTargets(): Promise<void> {
		this.targets = await listTransferBlocks(this.app, this.settings, this.row.source);
		this.renderBlockOptions();
	}

	private renderBlockOptions(): void {
		this.blockSelect.empty();

		if (this.targets.length === 0) {
			this.blockSelect.createEl("option", { text: "No destination decks or collections found", value: "" });
			this.updateApplyState();
			return;
		}

		for (const block of this.targets) {
			this.blockSelect.createEl("option", {
				text: block.label,
				value: `${block.path}\u0000${block.lineStart}\u0000${block.language}`,
			});
		}
		this.updateApplyState();
	}

	private getSelectedTarget(): TransferTargetBlock | null {
		const value = this.blockSelect.value;
		return (
			this.targets.find(
				(target) =>
					`${target.path}\u0000${target.lineStart}\u0000${target.language}` === value
			) ?? null
		);
	}

	private getQuantity(): number {
		const quantity = Number.parseInt(this.quantityInput.value, 10);
		return Number.isFinite(quantity) ? quantity : 0;
	}

	private updateApplyState(): void {
		const quantity = this.getQuantity();
		this.applyButton.disabled =
			!this.getSelectedTarget() ||
			quantity < 1 ||
			quantity > this.row.availableQuantity;
	}

	private async apply(): Promise<void> {
		const target = this.getSelectedTarget();
		const quantity = this.getQuantity();
		if (!target || quantity < 1 || quantity > this.row.availableQuantity) {
			return;
		}

		this.applyButton.disabled = true;
		try {
			await applyTransfer(this.app, this.settings, this.row.source, target, this.row.cardName, quantity);
			await this.row.source.onTransferComplete?.();
			new Notice(`Transferred ${quantity} ${this.row.cardName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Transfer failed.";
			new Notice(message);
			this.applyButton.disabled = false;
		}
	}
}

export function createTransferButton(
	app: App,
	settings: MTGSettings,
	row: TransferRowContext
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "mtg-transfer-button";
	button.disabled = row.availableQuantity <= 0;
	button.setAttribute(
		"aria-label",
		button.disabled
			? `No movable copies of ${row.cardName}`
			: `Transfer ${row.cardName}`
	);
	setIcon(button, "arrow-right-left");
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		if (button.disabled) {
			return;
		}
		new CardTransferModal(app, settings, row).open();
	});
	return button;
}
