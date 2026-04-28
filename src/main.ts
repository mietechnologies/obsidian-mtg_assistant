import { Extension } from "@codemirror/state";
import { MarkdownView, Plugin, WorkspaceLeaf } from "obsidian";
import { CardCache } from "./cache/cardCache";
import { buildEditorExtension } from "./render/cardEditorExtension";
import { buildReadingViewProcessor, MtgPopover } from "./render/cardImageRenderer";
import { DEFAULT_SETTINGS, MTGSettings, MTGSettingTab } from "./settings";

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

		this.editorExtensions.push(
			buildEditorExtension(this.cache, () => this.settings, this.popover)
		);
		this.registerEditorExtension(this.editorExtensions);

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
	}

	private getMarkdownView(leaf: WorkspaceLeaf): MarkdownView | null {
		return leaf.view instanceof MarkdownView ? leaf.view : null;
	}
}
