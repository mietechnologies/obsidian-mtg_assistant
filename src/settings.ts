import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import MtgAssistantPlugin from "./main";

export interface MTGSettings {
	cardPrefix: string;
	maxImageWidth: string;
	showCardName: boolean;
	enableReadingView: boolean;
	enableLivePreview: boolean;
	cacheTTLDays: number;
}

export const DEFAULT_SETTINGS: MTGSettings = {
	cardPrefix: "mtg",
	maxImageWidth: "265px",
	showCardName: false,
	enableReadingView: true,
	enableLivePreview: true,
	cacheTTLDays: 30,
};

export class MTGSettingTab extends PluginSettingTab {
	plugin: MtgAssistantPlugin;

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
			.setName("Maximum image width")
			.setDesc("CSS width value for card images in the hover popover.")
			.addText((text) =>
				text
					.setPlaceholder("265px")
					.setValue(this.plugin.settings.maxImageWidth)
					.onChange(async (value) => {
						this.plugin.settings.maxImageWidth = value.trim() || "265px";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Show card name under image")
			.setDesc("Display the resolved card name below the image in the hover popover.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showCardName)
					.onChange(async (value) => {
						this.plugin.settings.showCardName = value;
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
			.setName("Cache duration in days")
			.setDesc("How long lookup results stay cached before checking again.")
			.addSlider((slider) =>
				slider
					.setLimits(1, 365, 1)
					.setValue(this.plugin.settings.cacheTTLDays)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cacheTTLDays = value;
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
}
