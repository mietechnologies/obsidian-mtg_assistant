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

class MtgCollectionWidget extends WidgetType {
	constructor(
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
		const container = document.createElement("div");
		container.className = "mtg-collection-widget";

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
			onUpdateSource: updateSource,
			onActivateEditor: activateEditor,
		});

		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function buildDecorations(
	state: EditorState,
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
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): Extension {
	const field = StateField.define<DecorationSet>({
		create(state) {
			return buildDecorations(state, cache, getSettings, popover);
		},
		update(_value, transaction) {
			return buildDecorations(transaction.state, cache, getSettings, popover);
		},
		provide: (stateField) => EditorView.decorations.from(stateField),
	});

	return Prec.highest(field);
}
