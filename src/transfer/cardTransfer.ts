import { App, Modal, Notice, setIcon, TFile } from "obsidian";
import { parseCollectionList, parseDeckList } from "../parser/deckParser";
import { MTGSettings } from "../settings";
import { createColorIdentityElement } from "../render/colorIdentity";

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

export interface CardTransferModalOptions {
	allowRemove?: boolean;
	allowAddNew?: boolean;
}

export interface TransferSourceOption extends TransferSourceContext {
	label: string;
	availableQuantity: number;
}

export interface FixedTransferTarget extends TransferBlockRef {
	label: string;
}

export interface DeckBreakdownContext {
	source: TransferSourceContext;
	deckName: string;
	digitalOnly: boolean;
	getCardDetails?: () => DeckBreakdownCardDetails[];
}

export interface DeckBreakdownCardDetails {
	cardName: string;
	unitPrice: number | null;
	colorIdentity: string[];
}

interface LocatedBlock {
	startLine: number;
	endLine: number;
	source: string;
}

interface TransferTargetBlock extends TransferBlockRef {
	label: string;
}

interface DeckBreakdownCard {
	cardName: string;
	quantity: number;
	currentPriceText: string;
	colorIdentity: string[];
	defaultTargetValue: string;
}

interface DeckBreakdownAssignment extends DeckBreakdownCard {
	target: TransferTargetBlock | null;
}

interface PlannedDeckBreakdown {
	assignments: DeckBreakdownAssignment[];
	movedQuantity: number;
	removedQuantity: number;
	remainingQuantity: number;
}

const DECK_BREAKDOWN_REMOVE_VALUE = "__mtg_remove_from_collection__";

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

function buildTargetLabel(
	file: TFile,
	block: TransferBlockRef,
	settings: MTGSettings,
	blockCountInFile: number,
	blockIndexInFile: number
): string {
	const kind = block.language === "deck" ? "deck" : "collection";
	const name = parseBlockName(block, settings);
	if (name) {
		return `${file.basename} - ${name}`;
	}

	if (blockCountInFile <= 1) {
		return file.basename;
	}

	return `${file.basename} - ${kind} ${blockIndexInFile + 1}`;
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
		const fileBlocks: TransferBlockRef[] = [];
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
				fileBlocks.push(block);
			}
		}

		fileBlocks.sort((left, right) => left.lineStart - right.lineStart);
		for (let index = 0; index < fileBlocks.length; index += 1) {
			const block = fileBlocks[index];
			if (!block) {
				continue;
			}

			if (
				block.path === source.path &&
				block.lineStart === source.lineStart &&
				block.language === source.language
			) {
				continue;
			}

			blocks.push({
				...block,
				label: buildTargetLabel(file, block, settings, fileBlocks.length, index),
			});
		}
	}

	return blocks.sort((left, right) => {
		const labelDelta = left.label.localeCompare(right.label);
		if (labelDelta !== 0) return labelDelta;

		const pathDelta = left.path.localeCompare(right.path);
		if (pathDelta !== 0) return pathDelta;

		return left.lineStart - right.lineStart;
	});
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
		const line = lines[index] ?? "";
		const commanderMatch = /^(\s*commander\s*:\s*)(.+?)(\s*)$/i.exec(line);
		if (commanderMatch?.[2]) {
			const parsedCommander = parseHaveMetadata(commanderMatch[2]);
			if (normalizeCardKey(parsedCommander.cardText) !== targetKey) {
				continue;
			}

			const nextHave = Math.max(0, Math.min(1, (parsedCommander.have ?? 0) + delta));
			lines[index] =
				`${commanderMatch[1]}${formatDeckCardText(parsedCommander.cardText, nextHave)}${commanderMatch[3] ?? ""}`;
			return lines.join("\n");
		}

		const parsed = parseCardLine(line);
		if (parsed) {
			if (normalizeCardKey(parsed.cardText) !== targetKey) {
				continue;
			}

			const nextHave = Math.max(0, Math.min(parsed.quantity, (parsed.have ?? 0) + delta));
			lines[index] =
				`${parsed.prefix}${parsed.quantity} ${formatDeckCardText(parsed.cardText, nextHave)}${parsed.suffix}`;
			return lines.join("\n");
		}

		const implicitCardMatch = /^(\s*(?:[-*+]\s+)?)(.+?)(\s*)$/.exec(line);
		if (!implicitCardMatch?.[2]) {
			continue;
		}

		const implicitParsed = parseHaveMetadata(implicitCardMatch[2]);
		if (normalizeCardKey(implicitParsed.cardText) !== targetKey) {
			continue;
		}

		const nextHave = Math.max(0, Math.min(1, (implicitParsed.have ?? 0) + delta));
		lines[index] =
			`${implicitCardMatch[1] ?? ""}${formatDeckCardText(implicitParsed.cardText, nextHave)}${implicitCardMatch[3] ?? ""}`;
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

function formatBreakdownPrice(quantity: number, unitPrice: number | null): string {
	if (unitPrice === null) return "N/A";
	return `$${(quantity * unitPrice).toFixed(2)}`;
}

function getTargetValue(target: TransferTargetBlock): string {
	return `${target.path}\u0000${target.lineStart}\u0000${target.language}`;
}

function deckNeedsCard(target: TransferTargetBlock, cardName: string, settings: MTGSettings): boolean {
	if (target.language !== "deck") {
		return false;
	}

	const targetKey = normalizeCardKey(cardName);
	return parseDeckList(target.source, settings.commanderMarker).cards.some((card) => {
		if (normalizeCardKey(card.cardName) !== targetKey) {
			return false;
		}

		return card.quantity - (card.have ?? 0) > 0;
	});
}

function getDeckBreakdownCards(
	source: string,
	settings: MTGSettings,
	details: DeckBreakdownCardDetails[],
	targets: TransferTargetBlock[]
): DeckBreakdownCard[] {
	const detailsByCard = new Map(
		details.map((detail) => [normalizeCardKey(detail.cardName), detail])
	);
	return parseDeckList(source, settings.commanderMarker).cards
		.map((card) => {
			const quantity = card.have ?? 0;
			const detail = detailsByCard.get(normalizeCardKey(card.cardName));
			const defaultTarget = targets.find((target) => deckNeedsCard(target, card.cardName, settings));
			return {
				cardName: card.cardName,
				quantity,
				currentPriceText: formatBreakdownPrice(quantity, detail?.unitPrice ?? null),
				colorIdentity: detail?.colorIdentity ?? [],
				defaultTargetValue: defaultTarget ? getTargetValue(defaultTarget) : "",
			};
		})
		.filter((card) => card.quantity > 0);
}

function removeLocatedBlock(lines: string[], block: LocatedBlock): void {
	lines.splice(block.startLine, block.endLine - block.startLine + 1);
}

function addCardsToBlockSource(
	block: TransferBlockRef,
	cards: Array<Pick<DeckBreakdownCard, "cardName" | "quantity">>
): string {
	return cards.reduce(
		(nextSource, card) =>
			updateBlockSource({ ...block, source: nextSource }, card.cardName, card.quantity),
		block.source
	);
}

function getDeckRemainingNeed(source: string, cardName: string, settings: MTGSettings): number {
	const targetKey = normalizeCardKey(cardName);
	return parseDeckList(source, settings.commanderMarker).cards.reduce((sum, card) => {
		if (normalizeCardKey(card.cardName) !== targetKey) {
			return sum;
		}

		return sum + Math.max(0, card.quantity - (card.have ?? 0));
	}, 0);
}

function planDeckBreakdown(
	assignments: DeckBreakdownAssignment[],
	settings: MTGSettings
): PlannedDeckBreakdown {
	const plannedAssignments: DeckBreakdownAssignment[] = [];
	const remainingNeedByTargetCard = new Map<string, number>();
	let movedQuantity = 0;
	let removedQuantity = 0;
	let remainingQuantity = 0;

	for (const assignment of assignments) {
		if (assignment.quantity <= 0) {
			continue;
		}

		if (!assignment.target) {
			plannedAssignments.push(assignment);
			removedQuantity += assignment.quantity;
			continue;
		}

		if (assignment.target.language === "collection") {
			plannedAssignments.push(assignment);
			movedQuantity += assignment.quantity;
			continue;
		}

		const capacityKey = `${getTargetValue(assignment.target)}\u0000${normalizeCardKey(assignment.cardName)}`;
		let remainingNeed = remainingNeedByTargetCard.get(capacityKey);
		if (remainingNeed === undefined) {
			remainingNeed = getDeckRemainingNeed(
				assignment.target.source,
				assignment.cardName,
				settings
			);
		}

		const quantityToMove = Math.min(assignment.quantity, remainingNeed);
		remainingNeedByTargetCard.set(capacityKey, Math.max(0, remainingNeed - quantityToMove));

		if (quantityToMove > 0) {
			plannedAssignments.push({
				...assignment,
				quantity: quantityToMove,
			});
			movedQuantity += quantityToMove;
		}

		remainingQuantity += assignment.quantity - quantityToMove;
	}

	return {
		assignments: plannedAssignments,
		movedQuantity,
		removedQuantity,
		remainingQuantity,
	};
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

async function removeFromSource(
	app: App,
	settings: MTGSettings,
	source: TransferSourceContext,
	cardName: string,
	quantity: number
): Promise<void> {
	if (quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) {
		throw new Error("Remove quantity must be positive.");
	}

	const sourceFile = app.vault.getAbstractFileByPath(source.path);
	if (!(sourceFile instanceof TFile)) {
		throw new Error("Could not find the source note.");
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
}

async function addNewToBlock(
	app: App,
	settings: MTGSettings,
	target: TransferBlockRef,
	cardName: string,
	quantity: number
): Promise<void> {
	if (quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) {
		throw new Error("Add quantity must be positive.");
	}

	const targetFile = app.vault.getAbstractFileByPath(target.path);
	if (!(targetFile instanceof TFile)) {
		throw new Error("Could not find the target note.");
	}

	await app.vault.process(targetFile, (content) => {
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const block = locateBlock(content, target.lineStart, target.language, settings);
		if (!block) {
			throw new Error("Could not locate the target block.");
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

async function removeDeckBlock(
	app: App,
	settings: MTGSettings,
	source: TransferSourceContext
): Promise<void> {
	const sourceFile = app.vault.getAbstractFileByPath(source.path);
	if (!(sourceFile instanceof TFile)) {
		throw new Error("Could not find the deck note.");
	}

	await app.vault.process(sourceFile, (content) => {
		const eol = content.includes("\r\n") ? "\r\n" : "\n";
		const block = locateBlock(content, source.lineStart, "deck", settings);
		if (!block) {
			throw new Error("Could not locate the deck block.");
		}

		const lines = content.split(/\r?\n/);
		removeLocatedBlock(lines, block);
		return lines.join(eol);
	});
}

async function applyDeckBreakdown(
	app: App,
	settings: MTGSettings,
	source: TransferSourceContext,
	assignments: DeckBreakdownAssignment[]
): Promise<PlannedDeckBreakdown> {
	const plan = planDeckBreakdown(assignments, settings);
	if (assignments.length === 0) {
		await removeDeckBlock(app, settings, source);
		return plan;
	}

	const sourceFile = app.vault.getAbstractFileByPath(source.path);
	if (!(sourceFile instanceof TFile)) {
		throw new Error("Could not find the deck note.");
	}

	if (plan.assignments.length === 0) {
		return plan;
	}

	const assignmentsByFile = new Map<string, DeckBreakdownAssignment[]>();
	for (const assignment of plan.assignments) {
		if (!assignment.target) {
			continue;
		}

		const currentAssignments = assignmentsByFile.get(assignment.target.path);
		if (currentAssignments) {
			currentAssignments.push(assignment);
		} else {
			assignmentsByFile.set(assignment.target.path, [assignment]);
		}
	}

	for (const [path, fileAssignments] of assignmentsByFile) {
		const targetFile = app.vault.getAbstractFileByPath(path);
		if (!(targetFile instanceof TFile)) {
			throw new Error("Could not find the destination note.");
		}

		await app.vault.process(targetFile, (content) => {
			const eol = content.includes("\r\n") ? "\r\n" : "\n";
			const lines = content.split(/\r?\n/);
			const assignmentsByTarget = new Map<string, DeckBreakdownAssignment[]>();

			for (const assignment of fileAssignments) {
				if (!assignment.target) {
					continue;
				}

				const key = `${assignment.target.lineStart}\u0000${assignment.target.language}`;
				const currentAssignments = assignmentsByTarget.get(key);
				if (currentAssignments) {
					currentAssignments.push(assignment);
				} else {
					assignmentsByTarget.set(key, [assignment]);
				}
			}

			const replacements: Array<{
				block: LocatedBlock;
				language: TransferBlockLanguage;
				source: string;
				remove: boolean;
			}> = [];

			for (const targetAssignments of assignmentsByTarget.values()) {
				const target = targetAssignments[0]?.target;
				if (!target) {
					continue;
				}

				const targetBlock = locateBlock(content, target.lineStart, target.language, settings);
				if (!targetBlock) {
					throw new Error("Could not locate a destination block.");
				}

				replacements.push({
					block: targetBlock,
					language: target.language,
					source: addCardsToBlockSource(
						{ ...target, source: targetBlock.source },
						targetAssignments.map((assignment) => ({
							cardName: assignment.cardName,
							quantity: assignment.quantity,
						}))
					),
					remove: false,
				});
			}

			if (path === source.path) {
				const sourceBlock = locateBlock(content, source.lineStart, "deck", settings);
				if (!sourceBlock) {
					throw new Error("Could not locate the deck block.");
				}
				replacements.push({
					block: sourceBlock,
					language: "deck",
					source: addCardsToBlockSource(
						{ ...source, source: sourceBlock.source },
						plan.assignments.map((assignment) => ({
							cardName: assignment.cardName,
							quantity: -assignment.quantity,
						}))
					),
					remove: plan.remainingQuantity === 0,
				});
			}

			replacements.sort((left, right) => right.block.startLine - left.block.startLine);
			for (const replacement of replacements) {
				if (replacement.remove) {
					removeLocatedBlock(lines, replacement.block);
					continue;
				}
				replaceBlockSource(lines, replacement.block, replacement.language, settings, replacement.source);
			}

			return lines.join(eol);
		});
	}

	if (!assignmentsByFile.has(source.path)) {
		if (plan.remainingQuantity === 0) {
			await removeDeckBlock(app, settings, source);
		} else {
			await app.vault.process(sourceFile, (content) => {
				const eol = content.includes("\r\n") ? "\r\n" : "\n";
				const sourceBlock = locateBlock(content, source.lineStart, "deck", settings);
				if (!sourceBlock) {
					throw new Error("Could not locate the deck block.");
				}

				const lines = content.split(/\r?\n/);
				replaceBlockSource(
					lines,
					sourceBlock,
					"deck",
					settings,
					addCardsToBlockSource(
						{ ...source, source: sourceBlock.source },
						plan.assignments.map((assignment) => ({
							cardName: assignment.cardName,
							quantity: -assignment.quantity,
						}))
					)
				);
				return lines.join(eol);
			});
		}
	}

	return plan;
}

export class CardTransferModal extends Modal {
	private targets: TransferTargetBlock[] = [];
	private blockSelect!: HTMLSelectElement;
	private quantityInput!: HTMLInputElement;
	private applyButton!: HTMLButtonElement;
	private addNewButton?: HTMLButtonElement;
	private removeButton?: HTMLButtonElement;

	constructor(
		app: App,
		private readonly settings: MTGSettings,
		private readonly row: TransferRowContext,
		private readonly options: CardTransferModalOptions = {}
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

		if (this.options.allowAddNew) {
			this.addNewButton = actions.createEl("button", {
				text: "Add new",
			});
			this.addNewButton.type = "button";
			this.addNewButton.disabled = true;
			this.addNewButton.addEventListener("click", () => {
				void this.addNew();
			});
		}

		if (this.options.allowRemove) {
			this.removeButton = actions.createEl("button", {
				text: "Remove",
				cls: "mod-warning",
			});
			this.removeButton.type = "button";
			this.removeButton.disabled = true;
			this.removeButton.addEventListener("click", () => {
				void this.remove();
			});
		}

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
				(target) => getTargetValue(target) === value
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
		if (this.removeButton) {
			this.removeButton.disabled =
				quantity < 1 ||
				quantity > this.row.availableQuantity;
		}
		if (this.addNewButton) {
			this.addNewButton.disabled = quantity < 1;
		}
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

	private async remove(): Promise<void> {
		const quantity = this.getQuantity();
		if (quantity < 1 || quantity > this.row.availableQuantity) {
			return;
		}

		this.applyButton.disabled = true;
		if (this.removeButton) {
			this.removeButton.disabled = true;
		}
		try {
			await removeFromSource(this.app, this.settings, this.row.source, this.row.cardName, quantity);
			await this.row.source.onTransferComplete?.();
			new Notice(`Removed ${quantity} ${this.row.cardName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Remove failed.";
			new Notice(message);
			this.applyButton.disabled = false;
			if (this.removeButton) {
				this.removeButton.disabled = false;
			}
		}
	}

	private async addNew(): Promise<void> {
		const quantity = this.getQuantity();
		if (quantity < 1) {
			return;
		}

		this.applyButton.disabled = true;
		if (this.addNewButton) {
			this.addNewButton.disabled = true;
		}
		if (this.removeButton) {
			this.removeButton.disabled = true;
		}
		try {
			await addNewToBlock(this.app, this.settings, this.row.source, this.row.cardName, quantity);
			await this.row.source.onTransferComplete?.();
			new Notice(`Added ${quantity} ${this.row.cardName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Add failed.";
			new Notice(message);
			this.applyButton.disabled = false;
			if (this.addNewButton) {
				this.addNewButton.disabled = false;
			}
			if (this.removeButton) {
				this.removeButton.disabled = false;
			}
		}
	}
}

export class CardTransferToTargetModal extends Modal {
	private sourceSelect!: HTMLSelectElement;
	private quantityInput!: HTMLInputElement;
	private applyButton!: HTMLButtonElement;
	private addNewButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly settings: MTGSettings,
		private readonly cardName: string,
		private readonly sources: TransferSourceOption[],
		private readonly target: FixedTransferTarget,
		private readonly onTransferComplete?: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mtg-transfer-modal");
		contentEl.createEl("h3", { text: "Transfer card" });
		contentEl.createEl("p", {
			text: this.cardName,
			cls: "mtg-transfer-card-name",
		});
		contentEl.createEl("p", {
			cls: "mtg-transfer-meta",
			text: `To ${this.target.label}`,
		});

		this.sourceSelect = this.createLabeledSelect(contentEl, "Source collection");

		const quantityLabel = contentEl.createEl("label", { cls: "mtg-transfer-field" });
		quantityLabel.createEl("span", { text: "Quantity" });
		this.quantityInput = quantityLabel.createEl("input");
		this.quantityInput.type = "number";
		this.quantityInput.min = "1";
		this.quantityInput.value = "1";

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

		this.addNewButton = actions.createEl("button", {
			text: "Add new",
		});
		this.addNewButton.type = "button";
		this.addNewButton.disabled = true;
		this.addNewButton.addEventListener("click", () => {
			void this.addNew();
		});

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.type = "button";
		cancelButton.addEventListener("click", () => this.close());

		this.sourceSelect.addEventListener("change", () => this.updateQuantityLimit());
		this.quantityInput.addEventListener("input", () => this.updateApplyState());

		this.renderSourceOptions();
	}

	private createLabeledSelect(containerEl: HTMLElement, label: string): HTMLSelectElement {
		const wrapper = containerEl.createEl("label", { cls: "mtg-transfer-field" });
		wrapper.createEl("span", { text: label });
		return wrapper.createEl("select");
	}

	private renderSourceOptions(): void {
		this.sourceSelect.empty();
		if (this.sources.length === 0) {
			this.sourceSelect.createEl("option", { text: "No source collections found", value: "" });
			this.updateQuantityLimit();
			return;
		}

		for (const source of this.sources) {
			this.sourceSelect.createEl("option", {
				text: source.label,
				value: `${source.path}\u0000${source.lineStart}\u0000${source.language}`,
			});
		}
		this.updateQuantityLimit();
	}

	private getSelectedSource(): TransferSourceOption | null {
		const value = this.sourceSelect.value;
		return (
			this.sources.find(
				(source) =>
					`${source.path}\u0000${source.lineStart}\u0000${source.language}` === value
			) ?? null
		);
	}

	private getQuantity(): number {
		const quantity = Number.parseInt(this.quantityInput.value, 10);
		return Number.isFinite(quantity) ? quantity : 0;
	}

	private updateQuantityLimit(): void {
		const source = this.getSelectedSource();
		const max = source?.availableQuantity ?? 0;
		this.quantityInput.max = String(max);
		if (max > 0 && (this.getQuantity() < 1 || this.getQuantity() > max)) {
			this.quantityInput.value = "1";
		}
		this.updateApplyState();
	}

	private updateApplyState(): void {
		const source = this.getSelectedSource();
		const quantity = this.getQuantity();
		this.applyButton.disabled =
			!source ||
			quantity < 1 ||
			quantity > source.availableQuantity;
		this.addNewButton.disabled = quantity < 1;
	}

	private async apply(): Promise<void> {
		const source = this.getSelectedSource();
		const quantity = this.getQuantity();
		if (!source || quantity < 1 || quantity > source.availableQuantity) {
			return;
		}

		this.applyButton.disabled = true;
		try {
			await applyTransfer(this.app, this.settings, source, this.target, this.cardName, quantity);
			await source.onTransferComplete?.();
			await this.onTransferComplete?.();
			new Notice(`Transferred ${quantity} ${this.cardName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Transfer failed.";
			new Notice(message);
			this.applyButton.disabled = false;
		}
	}

	private async addNew(): Promise<void> {
		const quantity = this.getQuantity();
		if (quantity < 1) {
			return;
		}

		this.applyButton.disabled = true;
		this.addNewButton.disabled = true;
		try {
			await addNewToBlock(this.app, this.settings, this.target, this.cardName, quantity);
			await this.onTransferComplete?.();
			new Notice(`Added ${quantity} ${this.cardName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Add failed.";
			new Notice(message);
			this.applyButton.disabled = false;
			this.addNewButton.disabled = false;
		}
	}
}

export class DeckBreakdownModal extends Modal {
	private targets: TransferTargetBlock[] = [];
	private cards: DeckBreakdownCard[] = [];
	private assignmentSelects: HTMLSelectElement[] = [];
	private bulkSelect?: HTMLSelectElement;
	private assignmentsEl?: HTMLElement;
	private applyButton!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly settings: MTGSettings,
		private readonly context: DeckBreakdownContext
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("mtg-breakdown-modal-container");
		contentEl.addClass("mtg-transfer-modal", "mtg-breakdown-modal");
		contentEl.createEl("h3", {
			text: this.context.digitalOnly ? "Remove digital deck" : "Break down deck",
		});
		contentEl.createEl("p", {
			text: this.context.deckName,
			cls: "mtg-transfer-card-name",
		});

		if (this.context.digitalOnly) {
			contentEl.createEl("p", {
				text: "This will remove the digital deck block from the note.",
				cls: "mtg-transfer-meta",
			});
			this.renderActions("Remove deck", false, () => {
				void this.removeDigitalDeck();
			});
			return;
		}

		this.cards = getDeckBreakdownCards(this.context.source.source, this.settings, [], []);
		const quantity = this.cards.reduce((sum, card) => sum + card.quantity, 0);
		contentEl.createEl("p", {
			text: quantity > 0
				? `This will move ${quantity} owned card${quantity === 1 ? "" : "s"} and remove this deck block.`
				: "No cards are marked as owned. This will remove the deck block without moving cards.",
			cls: "mtg-transfer-meta",
		});

		if (quantity === 0) {
			this.renderActions("Remove deck", false, () => {
				void this.removePhysicalDeck();
			});
			return;
		}

		this.bulkSelect = this.createLabeledSelect(contentEl, "Set all destinations");
		this.bulkSelect.addEventListener("change", () => this.applyBulkDestination());
		this.assignmentsEl = contentEl.createEl("div", { cls: "mtg-breakdown-assignments" });
		this.renderActions("Break down deck", true, () => {
			void this.apply();
		});
		void this.loadTargets();
	}

	private createLabeledSelect(containerEl: HTMLElement, label: string): HTMLSelectElement {
		const wrapper = containerEl.createEl("label", { cls: "mtg-transfer-field" });
		wrapper.createEl("span", { text: label });
		return wrapper.createEl("select");
	}

	private renderActions(applyText: string, disabled: boolean, onApply: () => void): void {
		const actions = this.contentEl.createEl("div", { cls: "mtg-transfer-actions" });
		this.applyButton = actions.createEl("button", {
			text: applyText,
			cls: applyText === "Remove deck" ? "mod-warning" : "mod-cta",
		});
		this.applyButton.type = "button";
		this.applyButton.disabled = disabled;
		this.applyButton.addEventListener("click", onApply);

		const cancelButton = actions.createEl("button", { text: "Cancel" });
		cancelButton.type = "button";
		cancelButton.addEventListener("click", () => this.close());
	}

	private async loadTargets(): Promise<void> {
		this.targets = await listTransferBlocks(this.app, this.settings, this.context.source);
		this.cards = getDeckBreakdownCards(
			this.context.source.source,
			this.settings,
			this.context.getCardDetails?.() ?? [],
			this.targets
		);
		this.renderBlockOptions();
	}

	private renderBlockOptions(): void {
		this.assignmentSelects = [];
		this.bulkSelect?.empty();
		this.assignmentsEl?.empty();

		this.appendDestinationOptions(this.bulkSelect, "Choose destination for all cards");

		const table = this.assignmentsEl?.createEl("table", { cls: "mtg-breakdown-table" });
		const thead = table?.createEl("thead");
		const headRow = thead?.createEl("tr");
		headRow?.createEl("th", { text: "Qty" });
		headRow?.createEl("th", { text: "Card" });
		headRow?.createEl("th", { text: "Current price", cls: "mtg-breakdown-price" });
		headRow?.createEl("th", { text: "Color", cls: "mtg-breakdown-color" });
		headRow?.createEl("th", { text: "Destination" });
		const tbody = table?.createEl("tbody");

		for (const card of this.cards) {
			const row = tbody?.createEl("tr");
			row?.createEl("td", { text: String(card.quantity), cls: "mtg-breakdown-qty" });
			row?.createEl("td", { text: card.cardName });
			row?.createEl("td", { text: card.currentPriceText, cls: "mtg-breakdown-price" });
			const colorCell = row?.createEl("td", { cls: "mtg-breakdown-color" });
			colorCell?.appendChild(createColorIdentityElement(card.colorIdentity));
			const destinationCell = row?.createEl("td");
			const select = destinationCell?.createEl("select");
			if (!select) {
				continue;
			}
			this.appendDestinationOptions(select, "Choose destination or removal");
			select.value = card.defaultTargetValue;
			select.addEventListener("change", () => this.updateApplyState());
			this.assignmentSelects.push(select);
		}

		this.updateApplyState();
	}

	private appendDestinationOptions(select: HTMLSelectElement | undefined, placeholder: string): void {
		if (!select) {
			return;
		}

		select.createEl("option", { text: placeholder, value: "" });
		select.createEl("option", {
			text: "Remove from collection",
			value: DECK_BREAKDOWN_REMOVE_VALUE,
		});
		for (const block of this.targets) {
			select.createEl("option", {
				text: block.label,
				value: getTargetValue(block),
			});
		}
	}

	private applyBulkDestination(): void {
		if (!this.bulkSelect?.value) {
			return;
		}

		for (const select of this.assignmentSelects) {
			select.value = this.bulkSelect.value;
		}
		this.updateApplyState();
	}

	private getTargetByValue(value: string): TransferTargetBlock | null {
		if (!value) {
			return null;
		}

		return (
			this.targets.find(
				(target) => getTargetValue(target) === value
			) ?? null
		);
	}

	private getAssignments(): DeckBreakdownAssignment[] | null {
		if (this.assignmentSelects.length !== this.cards.length) {
			return null;
		}

		const assignments: DeckBreakdownAssignment[] = [];
		for (let index = 0; index < this.cards.length; index += 1) {
			const card = this.cards[index];
			const select = this.assignmentSelects[index];
			if (!card || !select) {
				return null;
			}

			const target = select.value === DECK_BREAKDOWN_REMOVE_VALUE
				? null
				: this.getTargetByValue(select.value);
			if (select.value !== DECK_BREAKDOWN_REMOVE_VALUE && !target) {
				return null;
			}

			assignments.push({
				...card,
				target,
			});
		}

		return assignments;
	}

	private updateApplyState(): void {
		this.applyButton.disabled = this.getAssignments() === null;
	}

	private async removeDigitalDeck(): Promise<void> {
		await this.removeDeck("Remove failed.");
	}

	private async removePhysicalDeck(): Promise<void> {
		await this.removeDeck("Remove failed.");
	}

	private async removeDeck(failureMessage: string): Promise<void> {
		this.applyButton.disabled = true;
		try {
			await removeDeckBlock(this.app, this.settings, this.context.source);
			await this.context.source.onTransferComplete?.();
			new Notice(`Removed ${this.context.deckName}.`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : failureMessage;
			new Notice(message);
			this.applyButton.disabled = false;
		}
	}

	private async apply(): Promise<void> {
		const assignments = this.getAssignments();
		if (!assignments) {
			return;
		}

		this.applyButton.disabled = true;
		try {
			const result = await applyDeckBreakdown(this.app, this.settings, this.context.source, assignments);
			await this.context.source.onTransferComplete?.();
			const removedText = result.removedQuantity > 0
				? ` Removed ${result.removedQuantity} card${result.removedQuantity === 1 ? "" : "s"}.`
				: "";
			const remainingText = result.remainingQuantity > 0
				? ` ${result.remainingQuantity} card${result.remainingQuantity === 1 ? "" : "s"} could not be moved because the selected deck did not need that many copies.`
				: "";
			const noticePrefix = result.remainingQuantity > 0
				? `Breakdown incomplete for ${this.context.deckName}.`
				: `Broke down ${this.context.deckName}.`;
			new Notice(`${noticePrefix} Moved ${result.movedQuantity} card${result.movedQuantity === 1 ? "" : "s"}.${removedText}${remainingText}`);
			this.close();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Breakdown failed.";
			new Notice(message);
			this.applyButton.disabled = false;
		}
	}
}

export function createDeckBreakdownButton(
	app: App,
	settings: MTGSettings,
	context: DeckBreakdownContext
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "mtg-block-action-button";
	button.setAttribute("aria-label", `Break down ${context.deckName}`);
	button.title = context.digitalOnly ? "Remove digital deck" : "Break down deck";
	setIcon(button, context.digitalOnly ? "trash-2" : "package-open");
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		new DeckBreakdownModal(app, settings, context).open();
	});
	return button;
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
		new CardTransferModal(app, settings, row, { allowAddNew: true }).open();
	});
	return button;
}
