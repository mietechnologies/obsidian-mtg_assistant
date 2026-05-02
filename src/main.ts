import { Extension } from "@codemirror/state";
import { MarkdownPostProcessorContext, MarkdownView, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { CardCache } from "./cache/cardCache";
import { buildEditorExtension } from "./render/cardEditorExtension";
import { buildReadingViewProcessor, MtgPopover } from "./render/cardImageRenderer";
import { buildDeckEditorExtension } from "./render/deckEditorExtension";
import { buildCollectionEditorExtension } from "./render/collectionEditorExtension";
import { renderCollectionTable } from "./render/collectionRenderer";
import { renderDeckTable } from "./render/deckRenderer";
import {
	DEFAULT_SETTINGS,
	MTGSettings,
	MTGSettingTab,
	normalizeCollectionFolderPath,
} from "./settings";
import { isPathInFolder } from "./collection/collectionIndex";
import { COLLECTION_OVERVIEW_VIEW_TYPE, CollectionOverviewView } from "./view/collectionOverviewView";

export default class MtgAssistantPlugin extends Plugin {
	settings: MTGSettings;
	cache: CardCache;
	private popover: MtgPopover;
	private editorExtensions: Extension[] = [];

	async onload() {
		await this.loadSettings();

		this.cache = new CardCache(this.app, this.manifest.id, () => this.settings);
		await this.cache.init();

		this.popover = new MtgPopover();

		this.registerMarkdownPostProcessor(
			buildReadingViewProcessor(this.cache, () => this.settings, this.popover)
		);
		this.registerMarkdownPostProcessor((el, ctx) => {
			void this.renderStructuredBlocks(el, ctx);
		});

		this.editorExtensions.push(
			buildEditorExtension(this.cache, () => this.settings, this.popover)
		);
		this.editorExtensions.push(
			buildDeckEditorExtension(this.app, this.cache, () => this.settings, this.popover)
		);
		this.editorExtensions.push(
			buildCollectionEditorExtension(this.cache, () => this.settings, this.popover)
		);
		this.registerEditorExtension(this.editorExtensions);
		this.registerView(
			COLLECTION_OVERVIEW_VIEW_TYPE,
			(leaf) => new CollectionOverviewView(leaf, this.cache, () => this.settings, this.popover)
		);
		this.addCommand({
			id: "open-collection-overview",
			name: "Open collection overview",
			callback: () => {
				void this.activateCollectionOverview();
			},
		});
		this.registerVaultRefreshEvents();

		this.addSettingTab(new MTGSettingTab(this.app, this));
	}

	onunload() {
		this.popover.destroy();
		this.cache.destroy();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MTGSettings>
		);
		this.settings.collectionFolder = normalizeCollectionFolderPath(this.settings.collectionFolder);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshViews();
	}

	private refreshViews(): void {
		this.app.workspace.updateOptions();

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const markdownView = this.getMarkdownView(leaf);
			if (markdownView?.getMode() === "preview") {
				markdownView.previewMode.rerender(true);
			}
		}

		for (const leaf of this.app.workspace.getLeavesOfType(COLLECTION_OVERVIEW_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof CollectionOverviewView) {
				void view.refresh();
			}
		}
	}

	private getMarkdownView(leaf: WorkspaceLeaf): MarkdownView | null {
		return leaf.view instanceof MarkdownView ? leaf.view : null;
	}

	private async renderStructuredBlocks(
		el: HTMLElement,
		ctx: MarkdownPostProcessorContext
	): Promise<void> {
		for (const codeEl of Array.from(el.querySelectorAll<HTMLElement>("pre > code"))) {
			const classes = Array.from(codeEl.classList);
			const preEl = codeEl.parentElement;
			if (!(preEl instanceof HTMLPreElement) || !preEl.parentElement) continue;

			if (classes.includes(`language-${this.settings.deckCodeBlockLanguage}`)) {
				const container = document.createElement("div");
				preEl.replaceWith(container);
				await renderDeckTable(
					this.app,
					container,
					codeEl.textContent ?? "",
					this.cache,
					() => this.settings,
					this.popover
				);
				continue;
			}

			if (classes.includes(`language-${this.settings.collectionCodeBlockLanguage}`)) {
				const sectionInfo = ctx.getSectionInfo(preEl);
				const sourcePath = ctx.sourcePath;
				const container = document.createElement("div");
				preEl.replaceWith(container);
				await renderCollectionTable({
					containerEl: container,
					source: codeEl.textContent ?? "",
					cache: this.cache,
					getSettings: () => this.settings,
					popover: this.popover,
					onUpdateSource: async (nextSource) => {
						await this.updateCollectionBlockInFile(
							sourcePath,
							sectionInfo?.lineStart ?? 0,
							sectionInfo?.text ?? "",
							nextSource
						);
					},
				});
			}
		}
	}

	private registerVaultRefreshEvents(): void {
		const refreshIfCollectionNote = (path: string): void => {
			if (!isPathInFolder(path, this.settings.collectionFolder)) {
				return;
			}

			this.refreshViews();
		};

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					refreshIfCollectionNote(file.path);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					refreshIfCollectionNote(file.path);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				refreshIfCollectionNote(file.path);
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!(file instanceof TFile)) {
					return;
				}

				if (
					isPathInFolder(oldPath, this.settings.collectionFolder) ||
					isPathInFolder(file.path, this.settings.collectionFolder)
				) {
					this.refreshViews();
				}
			})
		);
	}

	private async activateCollectionOverview(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType(COLLECTION_OVERVIEW_VIEW_TYPE)[0];
		const leaf = existingLeaf ?? this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

			await leaf.setViewState({
				type: COLLECTION_OVERVIEW_VIEW_TYPE,
				active: true,
			});
			void this.app.workspace.revealLeaf(leaf);
		}

	private async updateCollectionBlockInFile(
		sourcePath: string,
		lineStart: number,
		sectionText: string,
		nextSource: string
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile) || !sectionText) {
			return;
		}

		const sectionLineCount = sectionText.split(/\r?\n/).length;
		const nextBlock = `\`\`\`${this.settings.collectionCodeBlockLanguage}\n${nextSource}\n\`\`\``;
		await this.app.vault.process(file, (currentContent) => {
			const eol = currentContent.includes("\r\n") ? "\r\n" : "\n";
			const currentLines = currentContent.split(/\r?\n/);
			const nextLines = nextBlock.split("\n");

			currentLines.splice(lineStart, sectionLineCount, ...nextLines);
			return currentLines.join(eol);
		});
	}
}
