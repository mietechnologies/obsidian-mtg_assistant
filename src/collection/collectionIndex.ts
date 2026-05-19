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

interface ParsedCollectionSource {
	sourcePath: string;
	source: string;
	lineStart: number;
}

interface ParsedCollectionFile {
	blockCount: number;
	sources: ParsedCollectionSource[];
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

function countLineBreaks(text: string): number {
	let count = 0;
	for (let index = 0; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) {
			count += 1;
		}
	}
	return count;
}

async function readCollectionFile(
	app: App,
	file: TFile,
	settings: MTGSettings
): Promise<ParsedCollectionFile> {
	const content = await app.vault.cachedRead(file);
	const regex = buildCollectionBlockRegex(settings.collectionCodeBlockLanguage);
	const sources: ParsedCollectionSource[] = [];
	let lineStart = 0;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(content)) !== null) {
		const blockStart = match.index + (match[1]?.length ?? 0);
		lineStart += countLineBreaks(content.slice(lastIndex, blockStart));
		sources.push({
			sourcePath: file.path,
			source: match[2] ?? "",
			lineStart,
		});
		lastIndex = blockStart;
	}

	return {
		blockCount: sources.length,
		sources,
	};
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

async function readCollectionFiles(
	app: App,
	settings: MTGSettings,
	concurrency = 8
): Promise<ParsedCollectionFile[]> {
	const files = getCollectionFiles(app, settings.collectionFolder);
	const results: ParsedCollectionFile[] = [];
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		while (nextIndex < files.length) {
			const currentIndex = nextIndex++;
			const file = files[currentIndex];
			if (!file) {
				continue;
			}

			results[currentIndex] = await readCollectionFile(app, file, settings);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(concurrency, Math.max(files.length, 1)) }, () => worker())
	);

	return results;
}

async function buildCollectionOverview(
	app: App,
	settings: MTGSettings
): Promise<CollectionOverview> {
	const quantities = new Map<string, number>();
	const rowsByKey = new Map<string, CollectionRow>();
	const parsedFiles = await readCollectionFiles(app, settings);

	let sourceFileCount = 0;
	let sourceBlockCount = 0;

	for (const parsedFile of parsedFiles) {
		if (!parsedFile || parsedFile.blockCount === 0) {
			continue;
		}

		for (const source of parsedFile.sources) {
			addCollectionSource(
				quantities,
				rowsByKey,
				source.sourcePath,
				source.source,
				source.lineStart
			);
		}

		sourceFileCount += 1;
		sourceBlockCount += parsedFile.blockCount;
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

export class CollectionIndex {
	private cachedOverview: CollectionOverview | null = null;
	private inflightOverview: Promise<CollectionOverview> | null = null;
	private version = 0;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => MTGSettings
	) {}

	invalidate(): void {
		this.version += 1;
		this.cachedOverview = null;
	}

	async loadOverview(): Promise<CollectionOverview> {
		if (this.cachedOverview) {
			return this.cachedOverview;
		}

		if (this.inflightOverview) {
			return this.inflightOverview;
		}

		const loadVersion = this.version;
		const promise = buildCollectionOverview(this.app, this.getSettings());
		this.inflightOverview = promise;

		try {
			const overview = await promise;
			if (this.version === loadVersion) {
				this.cachedOverview = overview;
			}
			return overview;
		} finally {
			if (this.inflightOverview === promise) {
				this.inflightOverview = null;
			}
		}
	}

	async loadTotals(): Promise<CollectionTotals> {
		const overview = await this.loadOverview();
		return {
			quantities: overview.quantities,
			sourceFileCount: overview.sourceFileCount,
			sourceBlockCount: overview.sourceBlockCount,
		};
	}
}

export async function loadCollectionTotals(
	app: App,
	settings: MTGSettings
): Promise<CollectionTotals> {
	const overview = await buildCollectionOverview(app, settings);
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
	return buildCollectionOverview(app, settings);
}
