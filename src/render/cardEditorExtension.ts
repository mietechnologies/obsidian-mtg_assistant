import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import { CardCache } from "../cache/cardCache";
import { buildCardReferenceRegex } from "../parser/cardReferenceParser";
import { MTGSettings } from "../settings";
import { attachHoverEvents, MtgPopover } from "./cardImageRenderer";

class MtgCardWidget extends WidgetType {
	constructor(
		private readonly cardName: string,
		private readonly cache: CardCache,
		private readonly getSettings: () => MTGSettings,
		private readonly popover: MtgPopover
	) {
		super();
	}

	eq(other: MtgCardWidget): boolean {
		return other.cardName === this.cardName;
	}

	toDOM(): HTMLElement {
		const span = document.createElement("span");
		span.className = "mtg-card-ref";
		span.textContent = this.cardName;
		span.tabIndex = 0;
		span.setAttribute("role", "button");
		span.setAttribute("aria-label", `Show Magic card preview for ${this.cardName}`);
		attachHoverEvents(span, this.cardName, this.cache, this.getSettings, this.popover);
		return span;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function buildDecorations(
	view: EditorView,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): DecorationSet {
	const settings = getSettings();
	if (!settings.enableLivePreview) return Decoration.none;

	const builder = new RangeSetBuilder<Decoration>();
	const selection = view.state.selection;

	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to);
		const regex = buildCardReferenceRegex(settings.cardPrefix);
		let match: RegExpExecArray | null;

		while ((match = regex.exec(text)) !== null) {
			const matchFrom = from + match.index;
			const matchTo = matchFrom + (match[0]?.length ?? 0);
			const cardName = match[1]?.trim() ?? "";
			if (!cardName) continue;

			const cursorInsideToken = selection.ranges.some(
				(range) => range.from < matchTo && range.to > matchFrom
			);
			if (cursorInsideToken) continue;

			builder.add(
				matchFrom,
				matchTo,
				Decoration.replace({
					widget: new MtgCardWidget(cardName, cache, getSettings, popover),
				})
			);
		}
	}

	return builder.finish();
}

export function buildEditorExtension(
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = buildDecorations(view, cache, getSettings, popover);
			}

			update(update: ViewUpdate) {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.selectionSet ||
					update.focusChanged
				) {
					this.decorations = buildDecorations(update.view, cache, getSettings, popover);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);
}
