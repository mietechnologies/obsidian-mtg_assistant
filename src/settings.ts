import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import MtgAssistantPlugin from "./main";

export interface MTGSettings {
	cardPrefix: string;
	maxImageWidth: number;
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

		new Setting(containerEl)
			.setName("Card prefix")
			.setDesc("Prefix used in inline references like [mtg:card name].")
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
			.setName("Card image width")
			.setDesc("Maximum width for card images in hover previews.")
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
			.setName("Foil price suffix")
			.setDesc("Short label shown after foil prices in hover previews.")
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
			.setDesc("Short label shown after etched prices in hover previews.")
			.addText((text) =>
				text
					.setPlaceholder("E")
					.setValue(this.plugin.settings.etchedPriceSuffix)
					.onChange(async (value) => {
						this.plugin.settings.etchedPriceSuffix = value.trim() || "E";
						await this.plugin.saveSettings();
					})
			);

		const deckListsSetting = new Setting(containerEl)
			.setName("Deck lists")
			.setHeading()
			.setDesc(this.getDeckListsDescription());

		new Setting(containerEl)
			.setName("Deck list code block tag")
			.setDesc("Code fence tag used for rendered deck lists.")
			.addText((text) =>
				text
					.setPlaceholder("Example: mtg-deck")
					.setValue(this.plugin.settings.deckCodeBlockLanguage)
					.onChange(async (value) => {
						this.plugin.settings.deckCodeBlockLanguage = value.trim() || "mtg-deck";
						deckListsSetting.setDesc(this.getDeckListsDescription());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Commander marker")
			.setDesc("Section label used to mark the commander block in a deck list.")
			.addText((text) =>
				text
					.setPlaceholder("Example: - commander:")
					.setValue(this.plugin.settings.commanderMarker)
					.onChange(async (value) => {
						this.plugin.settings.commanderMarker = value.trim() || "- Commander:";
						await this.plugin.saveSettings();
					})
			);

		const collectionListsSetting = new Setting(containerEl)
			.setName("Collection lists")
			.setHeading()
			.setDesc(this.getCollectionListsDescription());

		new Setting(containerEl)
			.setName("Collection list code block tag")
			.setDesc("Code fence tag used for rendered collection lists.")
			.addText((text) =>
				text
					.setPlaceholder("Example: mtg-collection")
					.setValue(this.plugin.settings.collectionCodeBlockLanguage)
					.onChange(async (value) => {
						this.plugin.settings.collectionCodeBlockLanguage =
							value.trim() || "mtg-collection";
						collectionListsSetting.setDesc(this.getCollectionListsDescription());
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Collections folder")
			.setDesc("Vault-relative folder that contains collection notes. Subfolders are included.")
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
			.setName("Remove collection rows at zero quantity")
			.setDesc("When enabled, collection rows are removed automatically when their quantity reaches zero.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.removeCollectionLineAtZero)
					.onChange(async (value) => {
						this.plugin.settings.removeCollectionLineAtZero = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Cache management").setHeading();

		new Setting(containerEl)
			.setName("Image cache duration in days")
			.setDesc("How long cached card images are kept before they are refreshed.")
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
			.setName("Metadata cache duration in hours")
			.setDesc("How long cached card data and prices are kept before they are refreshed.")
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
			.setName("Clear metadata cache")
			.setDesc("Remove cached card data so cards are looked up again the next time they are needed.")
				.addButton((button) =>
					button.setButtonText("Clear metadata").onClick(async () => {
						await this.plugin.cache.clearMetadataCache();
						new Notice("Metadata cache cleared.");
					})
				);

		new Setting(containerEl)
			.setName("Clear image cache")
			.setDesc("Delete all cached card images stored by the plugin.")
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

	private getDeckListsDescription(): string {
		return `Create a deck list with a code block using the tag below as the syntax hint and add one card per line.`;
	}

	private getCollectionListsDescription(): string {
		return `Create a collection list with a code block using the tag below as the syntax hint and add one card per line.`;
	}

	private parsePositiveInt(value: string, fallback: number): number {
		const parsed = Number.parseInt(value.trim(), 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
	}
}
