import { App } from "obsidian";
import { EditorState, Extension, Prec, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { CardCache } from "../cache/cardCache";
import { MTGSettings } from "../settings";
import { MtgPopover } from "./cardImageRenderer";
import { renderDeckTable } from "./deckRenderer";

function buildDeckBlockRegex(language: string): RegExp {
	const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp("(^|\\n)```" + escaped + "\\n([\\s\\S]*?)\\n```(?=\\n|$)", "g");
}

class MtgDeckWidget extends WidgetType {
	constructor(
		private readonly app: App,
		private readonly source: string,
		private readonly blockStart: number,
		private readonly cache: CardCache,
		private readonly getSettings: () => MTGSettings,
		private readonly popover: MtgPopover
	) {
		super();
	}

	eq(other: MtgDeckWidget): boolean {
		return other.source === this.source && other.blockStart === this.blockStart;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement("div");
		container.className = "mtg-deck-widget";
		container.addEventListener("click", (event) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target.closest("button, .mtg-card-ref, details, summary, a, input, select")
			) {
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
			this.getSettings,
			this.popover
		);
		return container;
	}

	ignoreEvent(): boolean {
		return false;
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
					cache,
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
