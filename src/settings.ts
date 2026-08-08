import { App, Notice, PluginSettingTab, Setting, normalizePath } from "obsidian";
import MtgAssistantPlugin from "./main";

interface SettingDefinition {
	name: string;
	desc?: string;
	render: (setting: Setting) => void;
}

export interface MTGSettings {
	cardPrefix: string;
	maxImageWidth: number;
	deckCodeBlockLanguage: string;
	collectionCodeBlockLanguage: string;
	collectionFolder: string;
	removeCollectionLineAtZero: boolean;
	commanderMarker: string;
	deckListsCollapsedByDefault: boolean;
	collectionListsCollapsedByDefault: boolean;
	deckSectionsCollapsedByDefault: boolean;
	collectionSectionsCollapsedByDefault: boolean;
	staticCacheTTLDays: number;
	priceCacheHours: number;
	foilPriceSuffix: string;
	etchedPriceSuffix: string;
}

export function normalizeCollectionFolderPath(folder: string): string {
	const trimmed = folder.trim();
	if (!trimmed) {
		return "collection";
	}

	return normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
}

export const DEFAULT_SETTINGS: MTGSettings = {
	cardPrefix: "mtg",
	maxImageWidth: 256,
	deckCodeBlockLanguage: "mtg-deck",
	collectionCodeBlockLanguage: "mtg-collection",
	collectionFolder: normalizeCollectionFolderPath("collection/"),
	removeCollectionLineAtZero: true,
	commanderMarker: "- Commander:",
	deckListsCollapsedByDefault: false,
	collectionListsCollapsedByDefault: false,
	deckSectionsCollapsedByDefault: false,
	collectionSectionsCollapsedByDefault: false,
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

		for (const definition of this.getSettingDefinitions()) {
			definition.render(new Setting(containerEl));
		}
	}

	getSettingDefinitions(): SettingDefinition[] {
		return [
			this.createSettingDefinition(
				"Card prefix",
				"Prefix used in inline references like [mtg:card name].",
				(setting) => this.configureCardPrefixSetting(setting)
			),
			this.createSettingDefinition(
				"Card image width",
				"Maximum width for card images in hover previews.",
				(setting) => this.configureCardImageWidthSetting(setting)
			),
			this.createSettingDefinition(
				"Foil price suffix",
				"Short label shown after foil prices in hover previews.",
				(setting) => this.configureFoilPriceSuffixSetting(setting)
			),
			this.createSettingDefinition(
				"Etched price suffix",
				"Short label shown after etched prices in hover previews.",
				(setting) => this.configureEtchedPriceSuffixSetting(setting)
			),
			this.createSettingDefinition("Deck lists", this.getDeckListsDescription(), (setting) => {
				setting.setHeading();
			}),
			this.createSettingDefinition(
				"Deck list code block tag",
				"Code fence tag used for rendered deck lists.",
				(setting) => this.configureDeckCodeBlockSetting(setting)
			),
			this.createSettingDefinition(
				"Commander marker (legacy)",
				"Legacy section label used to mark the commander block in older deck lists.",
				(setting) => this.configureCommanderMarkerSetting(setting)
			),
			this.createSettingDefinition(
				"Collapse deck lists by default",
				"When enabled, rendered deck lists start collapsed.",
				(setting) => this.configureDeckListsCollapsedSetting(setting)
			),
			this.createSettingDefinition(
				"Collapse deck sections by default",
				"When enabled, rendered deck sections start collapsed.",
				(setting) => this.configureDeckSectionsCollapsedSetting(setting)
			),
			this.createSettingDefinition(
				"Collection lists",
				this.getCollectionListsDescription(),
				(setting) => {
					setting.setHeading();
				}
			),
			this.createSettingDefinition(
				"Collection list code block tag",
				"Code fence tag used for rendered collection lists.",
				(setting) => this.configureCollectionCodeBlockSetting(setting)
			),
			this.createSettingDefinition(
				"Collections folder",
				"Vault-relative folder that contains collection notes. Subfolders are included.",
				(setting) => this.configureCollectionFolderSetting(setting)
			),
			this.createSettingDefinition(
				"Remove collection rows at zero quantity",
				"When enabled, collection rows are removed automatically when their quantity reaches zero.",
				(setting) => this.configureRemoveCollectionRowsSetting(setting)
			),
			this.createSettingDefinition(
				"Collapse collection lists by default",
				"When enabled, rendered collection lists start collapsed.",
				(setting) => this.configureCollectionListsCollapsedSetting(setting)
			),
			this.createSettingDefinition(
				"Collapse collection sections by default",
				"When enabled, rendered collection sections start collapsed.",
				(setting) => this.configureCollectionSectionsCollapsedSetting(setting)
			),
			this.createSettingDefinition("Cache management", undefined, (setting) => {
				setting.setHeading();
			}),
			this.createSettingDefinition(
				"Image cache duration in days",
				"How long cached card images are kept before they are refreshed.",
				(setting) => this.configureImageCacheDurationSetting(setting)
			),
			this.createSettingDefinition(
				"Metadata cache duration in hours",
				"How long cached card data and prices are kept before they are refreshed.",
				(setting) => this.configureMetadataCacheDurationSetting(setting)
			),
			this.createSettingDefinition(
				"Clear metadata cache",
				"Remove cached card data so cards are looked up again the next time they are needed.",
				(setting) => this.configureClearMetadataCacheSetting(setting)
			),
			this.createSettingDefinition(
				"Clear image cache",
				"Delete all cached card images stored by the plugin.",
				(setting) => this.configureClearImageCacheSetting(setting)
			),
		];
	}

	private createSettingDefinition(
		name: string,
		desc: string | undefined,
		configure: (setting: Setting) => void
	): SettingDefinition {
		return {
			name,
			desc,
			render: (setting) => {
				setting.setName(name);
				if (desc) {
					setting.setDesc(desc);
				}
				configure(setting);
			},
		};
	}

	private configureCardPrefixSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Example: mtg")
				.setValue(this.plugin.settings.cardPrefix)
				.onChange(async (value) => {
					this.plugin.settings.cardPrefix = value.trim() || "mtg";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCardImageWidthSetting(setting: Setting): void {
		setting.addSlider((slider) =>
			slider
				.setLimits(0, this.imageWidthOptions.length - 1, 1)
				.setValue(this.getImageWidthIndex(this.plugin.settings.maxImageWidth))
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.maxImageWidth = this.imageWidthOptions[value] ?? 256;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureFoilPriceSuffixSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("F")
				.setValue(this.plugin.settings.foilPriceSuffix)
				.onChange(async (value) => {
					this.plugin.settings.foilPriceSuffix = value.trim() || "F";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureEtchedPriceSuffixSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("E")
				.setValue(this.plugin.settings.etchedPriceSuffix)
				.onChange(async (value) => {
					this.plugin.settings.etchedPriceSuffix = value.trim() || "E";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureDeckCodeBlockSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Example: mtg-deck")
				.setValue(this.plugin.settings.deckCodeBlockLanguage)
				.onChange(async (value) => {
					this.plugin.settings.deckCodeBlockLanguage = value.trim() || "mtg-deck";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCommanderMarkerSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Example: - commander:")
				.setValue(this.plugin.settings.commanderMarker)
				.onChange(async (value) => {
					this.plugin.settings.commanderMarker = value.trim() || "- Commander:";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureDeckListsCollapsedSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.deckListsCollapsedByDefault)
				.onChange(async (value) => {
					this.plugin.settings.deckListsCollapsedByDefault = value;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureDeckSectionsCollapsedSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.deckSectionsCollapsedByDefault)
				.onChange(async (value) => {
					this.plugin.settings.deckSectionsCollapsedByDefault = value;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCollectionCodeBlockSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Example: mtg-collection")
				.setValue(this.plugin.settings.collectionCodeBlockLanguage)
				.onChange(async (value) => {
					this.plugin.settings.collectionCodeBlockLanguage =
						value.trim() || "mtg-collection";
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCollectionFolderSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("Example: collection/")
				.setValue(this.plugin.settings.collectionFolder)
				.onChange(async (value) => {
					this.plugin.settings.collectionFolder = normalizeCollectionFolderPath(value);
					await this.plugin.saveSettings();
				})
		);
	}

	private configureRemoveCollectionRowsSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.removeCollectionLineAtZero)
				.onChange(async (value) => {
					this.plugin.settings.removeCollectionLineAtZero = value;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCollectionListsCollapsedSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.collectionListsCollapsedByDefault)
				.onChange(async (value) => {
					this.plugin.settings.collectionListsCollapsedByDefault = value;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureCollectionSectionsCollapsedSetting(setting: Setting): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.collectionSectionsCollapsedByDefault)
				.onChange(async (value) => {
					this.plugin.settings.collectionSectionsCollapsedByDefault = value;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureImageCacheDurationSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("30")
				.setValue(String(this.plugin.settings.staticCacheTTLDays))
				.onChange(async (value) => {
					const parsed = this.parsePositiveInt(value, this.plugin.settings.staticCacheTTLDays);
					this.plugin.settings.staticCacheTTLDays = parsed;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureMetadataCacheDurationSetting(setting: Setting): void {
		setting.addText((text) =>
			text
				.setPlaceholder("24")
				.setValue(String(this.plugin.settings.priceCacheHours))
				.onChange(async (value) => {
					const parsed = this.parsePositiveInt(value, this.plugin.settings.priceCacheHours);
					this.plugin.settings.priceCacheHours = parsed;
					await this.plugin.saveSettings();
				})
		);
	}

	private configureClearMetadataCacheSetting(setting: Setting): void {
		setting.addButton((button) =>
			button.setButtonText("Clear metadata").onClick(async () => {
				await this.plugin.cache.clearMetadataCache();
				new Notice("Metadata cache cleared.");
			})
		);
	}

	private configureClearImageCacheSetting(setting: Setting): void {
		setting.addButton((button) =>
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
