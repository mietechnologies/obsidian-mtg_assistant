import { App, TFile } from "obsidian";
import { parseCollectionList } from "../parser/deckParser";
import { MTGSettings } from "../settings";

export interface CollectionRow {
	key: string;
	cardName: string;
	quantity: number;
	section?: string;
	sourcePaths: string[];
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
	return folder.replace(/^\/+|\/+$/g, "");
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

function addCollectionSource(
	quantities: Map<string, number>,
	rowsByKey: Map<string, CollectionRow>,
	sourcePath: string,
	source: string
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
			continue;
		}

		rowsByKey.set(key, {
			key,
			cardName: card.cardName,
			quantity: card.quantity,
			section: card.section ? titleCaseSection(card.section) : undefined,
			sourcePaths: [sourcePath],
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
		addCollectionSource(quantities, rowsByKey, file.path, match[2] ?? "");
		blockCount += 1;
	}

	return blockCount;
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
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => isPathInFolder(file.path, settings.collectionFolder));

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
