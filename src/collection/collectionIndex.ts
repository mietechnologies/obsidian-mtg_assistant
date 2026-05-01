import { App, TFile, TFolder } from "obsidian";
import { parseCollectionList } from "../parser/deckParser";
import { normalizeCollectionFolderPath } from "../settings";
import { MTGSettings } from "../settings";

export interface CollectionRow {
	key: string;
	cardName: string;
	quantity: number;
	section?: string;
	sourcePaths: string[];
	sourceRefs: CollectionSourceRef[];
}

export interface CollectionSourceRef {
	sourcePath: string;
	lineStart: number;
	sectionText: string;
	quantity: number;
}

export interface CollectionTotals {
	quantities: Map<string, number>;
	sourceFileCount: number;
	sourceBlockCount: number;
}

export interface CollectionOverview {
	rows: CollectionRow[];
	quantities: Map<string, number>;
	sourceFileCount: number;
	sourceBlockCount: number;
	totalQuantity: number;
	uniqueCardCount: number;
}

function normalizeFolder(folder: string): string {
	return normalizeCollectionFolderPath(folder);
}

export function isPathInFolder(path: string, folder: string): boolean {
	const normalizedFolder = normalizeFolder(folder);
	if (!normalizedFolder) {
		return true;
	}

	return path === normalizedFolder || path.startsWith(`${normalizedFolder}/`);
}

function normalizeCardKey(cardName: string): string {
	return cardName.trim().toLowerCase();
}

function titleCaseSection(section: string): string {
	return section
		.trim()
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
		.join(" ");
}

function buildCollectionBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

function getLineStart(text: string, index: number): number {
	return text.slice(0, index).split(/\r?\n/).length - 1;
}

function addCollectionSource(
	quantities: Map<string, number>,
	rowsByKey: Map<string, CollectionRow>,
	sourcePath: string,
	source: string,
	lineStart: number
): void {
	const parsed = parseCollectionList(source);
	for (const card of parsed.cards) {
		if (card.quantity <= 0) {
			continue;
		}

		const key = normalizeCardKey(card.cardName);
		quantities.set(key, (quantities.get(key) ?? 0) + card.quantity);
		const existingRow = rowsByKey.get(key);
		if (existingRow) {
			existingRow.quantity += card.quantity;
			if (!existingRow.section && card.section) {
				existingRow.section = titleCaseSection(card.section);
			}
			if (!existingRow.sourcePaths.includes(sourcePath)) {
				existingRow.sourcePaths.push(sourcePath);
			}
			existingRow.sourceRefs.push({
				sourcePath,
				lineStart,
				sectionText: source,
				quantity: card.quantity,
			});
			continue;
		}

		rowsByKey.set(key, {
			key,
			cardName: card.cardName,
			quantity: card.quantity,
			section: card.section ? titleCaseSection(card.section) : undefined,
			sourcePaths: [sourcePath],
			sourceRefs: [
				{
					sourcePath,
					lineStart,
					sectionText: source,
					quantity: card.quantity,
				},
			],
		});
	}
}

async function readCollectionFile(
	app: App,
	file: TFile,
	settings: MTGSettings,
	quantities: Map<string, number>,
	rowsByKey: Map<string, CollectionRow>
): Promise<number> {
	const content = await app.vault.cachedRead(file);
	const regex = buildCollectionBlockRegex(settings.collectionCodeBlockLanguage);
	let blockCount = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const blockStart = match.index + (match[1]?.length ?? 0);
		const lineStart = getLineStart(content, blockStart);
		addCollectionSource(quantities, rowsByKey, file.path, match[2] ?? "", lineStart);
		blockCount += 1;
	}

	return blockCount;
}

function collectMarkdownFilesInFolder(folder: TFolder): TFile[] {
	const files: TFile[] = [];

	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === "md") {
			files.push(child);
			continue;
		}

		if (child instanceof TFolder) {
			files.push(...collectMarkdownFilesInFolder(child));
		}
	}

	return files;
}

function getCollectionFiles(app: App, folder: string): TFile[] {
	const normalizedFolder = normalizeFolder(folder);
	if (!normalizedFolder) {
		return app.vault.getMarkdownFiles();
	}

	const abstractFile = app.vault.getAbstractFileByPath(normalizedFolder);
	if (abstractFile instanceof TFile) {
		return abstractFile.extension === "md" ? [abstractFile] : [];
	}

	if (abstractFile instanceof TFolder) {
		return collectMarkdownFilesInFolder(abstractFile);
	}

	return [];
}

export async function loadCollectionTotals(
	app: App,
	settings: MTGSettings
): Promise<CollectionTotals> {
	const overview = await loadCollectionOverview(app, settings);
	return {
		quantities: overview.quantities,
		sourceFileCount: overview.sourceFileCount,
		sourceBlockCount: overview.sourceBlockCount,
	};
}

export async function loadCollectionOverview(
	app: App,
	settings: MTGSettings
): Promise<CollectionOverview> {
	const quantities = new Map<string, number>();
	const rowsByKey = new Map<string, CollectionRow>();
	const files = getCollectionFiles(app, settings.collectionFolder);

	let sourceFileCount = 0;
	let sourceBlockCount = 0;

	for (const file of files) {
		const blockCount = await readCollectionFile(app, file, settings, quantities, rowsByKey);
		if (blockCount === 0) {
			continue;
		}

		sourceFileCount += 1;
		sourceBlockCount += blockCount;
	}

	const rows = Array.from(rowsByKey.values()).sort((left, right) => {
		if (right.quantity !== left.quantity) {
			return right.quantity - left.quantity;
		}
		return left.cardName.localeCompare(right.cardName);
	});
	const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);

	return {
		rows,
		quantities,
		sourceFileCount,
		sourceBlockCount,
		totalQuantity,
		uniqueCardCount: rows.length,
	};
}
