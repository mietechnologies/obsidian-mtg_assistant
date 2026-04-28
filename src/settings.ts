import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import MtgAssistantPlugin from "./main";

export interface MTGSettings {
	cardPrefix: string;
	maxImageWidth: number;
	enableReadingView: boolean;
	enableLivePreview: boolean;
	deckCodeBlockLanguage: string;
	collectionCodeBlockLanguage: string;
	collectionFolder: string;
	removeCollectionLineAtZero: boolean;
	commanderMarker: string;
	staticCacheTTLDays: number;
	priceCacheHours: number;
	foilPriceSuffix: string;
	etchedPriceSuffix: string;
}

export const DEFAULT_SETTINGS: MTGSettings = {
	cardPrefix: "mtg",
	maxImageWidth: 256,
	enableReadingView: true,
	enableLivePreview: true,
	deckCodeBlockLanguage: "mtg-deck",
	collectionCodeBlockLanguage: "mtg-collection",
	collectionFolder: "collection/",
	removeCollectionLineAtZero: true,
	commanderMarker: "- Commander:",
	staticCacheTTLDays: 30,
	priceCacheHours: 24,
	foilPriceSuffix: "F",
	etchedPriceSuffix: "E",
};

export class MTGSettingTab extends PluginSettingTab {
	plugin: MtgAssistantPlugin;

	private readonly imageWidthOptions = [128, 256, 512];

	constructor(app: App, plugin: MtgAssistantPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Display").setHeading();

		new Setting(containerEl)
			.setName("Card prefix")
			.setDesc("Prefix used in references such as [mtg:card name].")
			.addText((text) =>
				text
					.setPlaceholder("Example: mtg")
					.setValue(this.plugin.settings.cardPrefix)
					.onChange(async (value) => {
						this.plugin.settings.cardPrefix = value.trim() || "mtg";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Deck code block language")
			.setDesc("Code fence language used for rendered deck lists.")
			.addText((text) =>
				text
					.setPlaceholder("Example: mtg-deck")
					.setValue(this.plugin.settings.deckCodeBlockLanguage)
					.onChange(async (value) => {
						this.plugin.settings.deckCodeBlockLanguage = value.trim() || "mtg-deck";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Collection code block language")
			.setDesc("Code fence language used for rendered collection lists.")
			.addText((text) =>
				text
					.setPlaceholder("Example: mtg-collection")
					.setValue(this.plugin.settings.collectionCodeBlockLanguage)
					.onChange(async (value) => {
						this.plugin.settings.collectionCodeBlockLanguage =
							value.trim() || "mtg-collection";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Collection folder")
			.setDesc("Vault-relative folder for collection notes. Subfolders are included for future collection features.")
			.addText((text) =>
				text
					.setPlaceholder("Example: collection/")
					.setValue(this.plugin.settings.collectionFolder)
					.onChange(async (value) => {
						this.plugin.settings.collectionFolder = value.trim() || "collection/";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Commander marker")
			.setDesc("Section label line used to mark a commander block inside a deck list.")
			.addText((text) =>
				text
					.setPlaceholder("Example: - commander:")
					.setValue(this.plugin.settings.commanderMarker)
					.onChange(async (value) => {
						this.plugin.settings.commanderMarker = value.trim() || "- Commander:";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Remove collection rows at zero quantity")
			.setDesc("When disabled, decreasing a collection card to zero keeps the row as 0 instead of deleting it.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.removeCollectionLineAtZero)
					.onChange(async (value) => {
						this.plugin.settings.removeCollectionLineAtZero = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Maximum image width")
			.setDesc("Maximum width for card images in the hover popover.")
			.addSlider((slider) =>
				slider
					.setLimits(0, this.imageWidthOptions.length - 1, 1)
					.setValue(this.getImageWidthIndex(this.plugin.settings.maxImageWidth))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxImageWidth = this.imageWidthOptions[value] ?? 256;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable in reading view")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableReadingView)
					.onChange(async (value) => {
						this.plugin.settings.enableReadingView = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable in live preview")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableLivePreview)
					.onChange(async (value) => {
						this.plugin.settings.enableLivePreview = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Static cache duration in days")
			.setDesc("How long card metadata and image references stay cached before a full refresh.")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(String(this.plugin.settings.staticCacheTTLDays))
					.onChange(async (value) => {
						const parsed = this.parsePositiveInt(value, this.plugin.settings.staticCacheTTLDays);
						this.plugin.settings.staticCacheTTLDays = parsed;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Price refresh interval in hours")
			.setDesc("How often cached prices should be refreshed from the card API.")
			.addText((text) =>
				text
					.setPlaceholder("24")
					.setValue(String(this.plugin.settings.priceCacheHours))
					.onChange(async (value) => {
						const parsed = this.parsePositiveInt(value, this.plugin.settings.priceCacheHours);
						this.plugin.settings.priceCacheHours = parsed;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Foil price suffix")
			.setDesc("Short label appended to foil prices in the preview.")
			.addText((text) =>
				text
					.setPlaceholder("F")
					.setValue(this.plugin.settings.foilPriceSuffix)
					.onChange(async (value) => {
						this.plugin.settings.foilPriceSuffix = value.trim() || "F";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Etched price suffix")
			.setDesc("Short label appended to etched prices in the preview.")
			.addText((text) =>
				text
					.setPlaceholder("E")
					.setValue(this.plugin.settings.etchedPriceSuffix)
					.onChange(async (value) => {
						this.plugin.settings.etchedPriceSuffix = value.trim() || "E";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Cache management").setHeading();

		new Setting(containerEl)
			.setName("Clear metadata cache")
			.setDesc("Remove cached lookup results so cards are resolved again on next hover.")
				.addButton((button) =>
					button.setButtonText("Clear metadata").onClick(async () => {
						await this.plugin.cache.clearMetadataCache();
						new Notice("Metadata cache cleared.");
					})
				);

		new Setting(containerEl)
			.setName("Clear image cache")
			.setDesc("Delete all locally cached card images.")
				.addButton((button) =>
					button
						.setButtonText("Clear images")
						.setWarning()
						.onClick(async () => {
							await this.plugin.cache.clearImageCache();
							new Notice("Image cache cleared.");
						})
				);
	}

	private getImageWidthIndex(width: number): number {
		const index = this.imageWidthOptions.indexOf(width);
		return index >= 0 ? index : 1;
	}

	private parsePositiveInt(value: string, fallback: number): number {
		const parsed = Number.parseInt(value.trim(), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	}
}
