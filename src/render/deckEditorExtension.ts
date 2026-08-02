import { App } from "obsidian";
import { EditorState, Extension, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { CardCache } from "../cache/cardCache";
import { CollectionIndex } from "../collection/collectionIndex";
import { MTGSettings } from "../settings";
import { MtgPopover } from "./cardImageRenderer";
import { renderDeckTable } from "./deckRenderer";

function buildDeckBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

function buildDeckBlockText(language: string, source: string): string {
	return `\`\`\`${language}\n${source}\n\`\`\``;
}

function isDeckWidgetInteractiveEvent(event: Event): boolean {
	const target = event.target;
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest("button, .mtg-section-toggle, .mtg-card-ref, details, summary, a, input, select"))
	);
}

class MtgDeckWidget extends WidgetType {
	constructor(
		private readonly app: App,
		private readonly source: string,
		private readonly blockStart: number,
		private readonly blockEnd: number,
		private readonly cache: CardCache,
		private readonly collectionIndex: CollectionIndex,
		private readonly getSettings: () => MTGSettings,
		private readonly popover: MtgPopover
	) {
		super();
	}

	eq(other: MtgDeckWidget): boolean {
		return (
			other.source === this.source &&
			other.blockStart === this.blockStart &&
			other.blockEnd === this.blockEnd
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement("div");
		container.className = "mtg-deck-widget";
		const activeFile = this.app.workspace.getActiveFile();
		const lineStart = view.state.doc.lineAt(this.blockStart).number - 1;
		const updateSource = (nextSource: string): void => {
			const nextBlock = buildDeckBlockText(
				this.getSettings().deckCodeBlockLanguage,
				nextSource
			);
			view.dispatch({
				changes: {
					from: this.blockStart,
					to: this.blockEnd,
					insert: nextBlock,
				},
			});
			this.collectionIndex.invalidate();
		};
		container.addEventListener("click", (event) => {
			if (isDeckWidgetInteractiveEvent(event)) {
				return;
			}
			view.dispatch({
				selection: { anchor: this.blockStart + 4 },
				scrollIntoView: true,
			});
			view.focus();
		});
		void renderDeckTable(
			this.app,
			container,
			this.source,
			this.cache,
			this.collectionIndex,
			this.getSettings,
			this.popover,
			updateSource,
			activeFile
				? {
					app: this.app,
					source: {
						path: activeFile.path,
						lineStart,
						language: "deck",
						source: this.source,
						onTransferComplete: () => {
							this.collectionIndex.invalidate();
						},
					},
				}
				: null,
			activeFile?.basename,
			activeFile ? `${activeFile.path}:${lineStart}:deck` : undefined
		);
		return container;
	}

	ignoreEvent(event: Event): boolean {
		return isDeckWidgetInteractiveEvent(event);
	}
}

function buildDecorations(
	state: EditorState,
	app: App,
	cache: CardCache,
	collectionIndex: CollectionIndex,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const settings = getSettings();

	const text = state.doc.toString();
	const regex = buildDeckBlockRegex(settings.deckCodeBlockLanguage);
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
				widget: new MtgDeckWidget(
					app,
					match[2] ?? "",
					blockStart,
					blockEnd,
					cache,
					collectionIndex,
					getSettings,
					popover
				),
			})
		);
	}

	return builder.finish();
}

export function buildDeckEditorExtension(
	app: App,
	cache: CardCache,
	collectionIndex: CollectionIndex,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): Extension {
	const field = StateField.define<DecorationSet>({
		create(state) {
			return buildDecorations(state, app, cache, collectionIndex, getSettings, popover);
		},
		update(_value, transaction) {
			return buildDecorations(
				transaction.state,
				app,
				cache,
				collectionIndex,
				getSettings,
				popover
			);
		},
		provide: (stateField) => EditorView.decorations.from(stateField),
	});

	return Prec.highest(field);
}
