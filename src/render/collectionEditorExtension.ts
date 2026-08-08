import { App } from "obsidian";
import { EditorState, Extension, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { CardCache } from "../cache/cardCache";
import { MTGSettings } from "../settings";
import { MtgPopover } from "./cardImageRenderer";
import { renderCollectionTable } from "./collectionRenderer";

function buildCollectionBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

function buildCollectionBlockText(language: string, source: string): string {
	return `\`\`\`${language}\n${source}\n\`\`\``;
}

function isCollectionWidgetInteractiveEvent(event: Event): boolean {
	const target = event.target;
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest("button, .mtg-section-toggle, .mtg-card-ref, details, summary, a, input, select"))
	);
}

class MtgCollectionWidget extends WidgetType {
	constructor(
		private readonly app: App,
		private readonly source: string,
		private readonly blockStart: number,
		private readonly blockEnd: number,
		private readonly cache: CardCache,
		private readonly getSettings: () => MTGSettings,
		private readonly popover: MtgPopover
	) {
		super();
	}

	eq(other: MtgCollectionWidget): boolean {
		return (
			other.source === this.source &&
			other.blockStart === this.blockStart &&
			other.blockEnd === this.blockEnd
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const container = createEl("div");
		container.className = "mtg-collection-widget";
		const activeFile = this.app.workspace.getActiveFile();
		const lineStart = view.state.doc.lineAt(this.blockStart).number - 1;

		const activateEditor = (): void => {
			view.dispatch({
				selection: { anchor: this.blockStart + 4 },
				scrollIntoView: true,
			});
			view.focus();
		};

		const updateSource = (nextSource: string): void => {
			const nextBlock = buildCollectionBlockText(
				this.getSettings().collectionCodeBlockLanguage,
				nextSource
			);
			view.dispatch({
				changes: {
					from: this.blockStart,
					to: this.blockEnd,
					insert: nextBlock,
				},
			});
		};

		void renderCollectionTable({
			containerEl: container,
			source: this.source,
			cache: this.cache,
			getSettings: this.getSettings,
			popover: this.popover,
			title: activeFile?.basename,
			stateKey: activeFile ? `${activeFile.path}:${lineStart}:collection` : undefined,
			onUpdateSource: updateSource,
			onActivateEditor: activateEditor,
			transfer: activeFile
				? {
					app: this.app,
					source: {
						path: activeFile.path,
						lineStart,
						language: "collection",
						source: this.source,
					},
				}
				: undefined,
		});

		return container;
	}

	ignoreEvent(event: Event): boolean {
		return isCollectionWidgetInteractiveEvent(event);
	}
}

function buildDecorations(
	state: EditorState,
	app: App,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const settings = getSettings();

	const text = state.doc.toString();
	const regex = buildCollectionBlockRegex(settings.collectionCodeBlockLanguage);
	const selection = state.selection;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(text)) !== null) {
		const matchText = match[0] ?? "";
		const blockStart = match.index + (match[1]?.length ?? 0);
		const blockEnd = blockStart + matchText.length - (match[1]?.length ?? 0);
		const cursorInsideBlock = selection.ranges.some(
			(range) => range.from <= blockEnd && range.to >= blockStart
		);
		if (cursorInsideBlock) {
			continue;
		}

		builder.add(
			blockStart,
			blockEnd,
			Decoration.replace({
				block: true,
				widget: new MtgCollectionWidget(
					app,
					match[2] ?? "",
					blockStart,
					blockEnd,
					cache,
					getSettings,
					popover
				),
			})
		);
	}

	return builder.finish();
}

export function buildCollectionEditorExtension(
	app: App,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): Extension {
	const field = StateField.define<DecorationSet>({
		create(state) {
			return buildDecorations(state, app, cache, getSettings, popover);
		},
		update(_value, transaction) {
			return buildDecorations(transaction.state, app, cache, getSettings, popover);
		},
		provide: (stateField) => EditorView.decorations.from(stateField),
	});

	return Prec.highest(field);
}
