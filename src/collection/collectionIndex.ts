import { App, TFile } from "obsidian";
import { parseCollectionList } from "../parser/deckParser";
import { MTGSettings } from "../settings";

export interface CollectionTotals {
	quantities: Map<string, number>;
	sourceFileCount: number;
	sourceBlockCount: number;
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

function buildCollectionBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

function addCollectionSource(
	quantities: Map<string, number>,
	source: string
): void {
	const parsed = parseCollectionList(source);
	for (const card of parsed.cards) {
		if (card.quantity <= 0) {
			continue;
		}

		const key = normalizeCardKey(card.cardName);
		quantities.set(key, (quantities.get(key) ?? 0) + card.quantity);
	}
}

async function readCollectionFile(
	app: App,
	file: TFile,
	settings: MTGSettings,
	quantities: Map<string, number>
): Promise<number> {
	const content = await app.vault.cachedRead(file);
	const regex = buildCollectionBlockRegex(settings.collectionCodeBlockLanguage);
	let blockCount = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		addCollectionSource(quantities, match[2] ?? "");
		blockCount += 1;
	}

	return blockCount;
}

export async function loadCollectionTotals(
	app: App,
	settings: MTGSettings
): Promise<CollectionTotals> {
	const quantities = new Map<string, number>();
	const files = app.vault
		.getMarkdownFiles()
		.filter((file) => isPathInFolder(file.path, settings.collectionFolder));

	let sourceFileCount = 0;
	let sourceBlockCount = 0;

	for (const file of files) {
		const blockCount = await readCollectionFile(app, file, settings, quantities);
		if (blockCount === 0) {
			continue;
		}

		sourceFileCount += 1;
		sourceBlockCount += blockCount;
	}

	return {
		quantities,
		sourceFileCount,
		sourceBlockCount,
	};
}
