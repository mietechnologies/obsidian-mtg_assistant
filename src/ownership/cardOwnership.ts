import { App } from "obsidian";
import { parseCollectionList, parseDeckList } from "../parser/deckParser";
import { MTGSettings } from "../settings";

export type OwnershipBlockLanguage = "collection" | "deck";

export interface OwnershipBlockRef {
	path: string;
	lineStart: number;
	language: OwnershipBlockLanguage;
	quantity: number;
}

export interface OwnershipExcludeRef {
	path: string;
	lineStart: number;
	language?: OwnershipBlockLanguage;
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

function shouldExcludeBlock(
	ref: OwnershipBlockRef,
	exclude?: OwnershipExcludeRef
): boolean {
	return Boolean(
		exclude &&
		ref.path === exclude.path &&
		ref.lineStart === exclude.lineStart &&
		(!exclude.language || ref.language === exclude.language)
	);
}

function addOwnershipRef(
	refsByKey: Map<string, OwnershipBlockRef[]>,
	cardName: string,
	ref: OwnershipBlockRef,
	exclude?: OwnershipExcludeRef
): void {
	if (ref.quantity <= 0 || shouldExcludeBlock(ref, exclude)) {
		return;
	}

	const key = normalizeCardKey(cardName);
	const refs = refsByKey.get(key);
	if (refs) {
		refs.push(ref);
		return;
	}

	refsByKey.set(key, [ref]);
}

export async function loadOwnershipRefsForCards(
	app: App,
	settings: MTGSettings,
	cardNames: string[],
	exclude?: OwnershipExcludeRef
): Promise<Map<string, OwnershipBlockRef[]>> {
	const wantedKeys = new Set(cardNames.map((cardName) => normalizeCardKey(cardName)));
	const refsByKey = new Map<string, OwnershipBlockRef[]>();
	if (wantedKeys.size === 0) {
		return refsByKey;
	}

	const languages: Array<[OwnershipBlockLanguage, string]> = [
		["collection", settings.collectionCodeBlockLanguage],
		["deck", settings.deckCodeBlockLanguage],
	];

	for (const file of app.vault.getMarkdownFiles()) {
		const content = await app.vault.cachedRead(file);
		for (const [language, codeBlockLanguage] of languages) {
			const regex = buildBlockRegex(codeBlockLanguage);
			let lineStart = 0;
			let lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = regex.exec(content)) !== null) {
				const blockStart = match.index + (match[1]?.length ?? 0);
				lineStart += countLineBreaks(content.slice(lastIndex, blockStart));
				lastIndex = blockStart;

				const source = match[2] ?? "";
				const parsed = language === "deck"
					? parseDeckList(source, settings.commanderMarker)
					: parseCollectionList(source);
				if (language === "deck" && parsed.digitalOnly) {
					continue;
				}

				for (const card of parsed.cards) {
					const key = normalizeCardKey(card.cardName);
					if (!wantedKeys.has(key)) {
						continue;
					}

					const quantity = language === "deck" ? (card.have ?? 0) : card.quantity;
					addOwnershipRef(
						refsByKey,
						card.cardName,
						{
							path: file.path,
							lineStart,
							language,
							quantity,
						},
						exclude
					);
				}
			}
		}
	}

	return refsByKey;
}
