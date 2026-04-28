import { CardCache, CardPreviewResult } from "../cache/cardCache";
import { buildCardReferenceRegex } from "../parser/cardReferenceParser";
import { MTGSettings } from "../settings";

type DisplayLegalityStatus = "legal" | "banned" | "restricted";

const POPOVER_LEGALITY_FORMATS: Array<{ key: string; label: string }> = [
	{ key: "standard", label: "Standard" },
	{ key: "pioneer", label: "Pioneer" },
	{ key: "modern", label: "Modern" },
	{ key: "pauper", label: "Pauper" },
	{ key: "commander", label: "Commander" },
	{ key: "brawl", label: "Brawl" },
	{ key: "duel", label: "Duel" },
	{ key: "oathbreaker", label: "Oathbreaker" },
	{ key: "legacy", label: "Legacy" },
	{ key: "vintage", label: "Vintage" },
];

function formatCardPrice(result: CardPreviewResult, settings: MTGSettings): string | null {
	const prices = result.card?.prices;
	if (!prices) {
		return null;
	}

	const segments: string[] = [];

	if (prices.usd) {
		segments.push(`$${prices.usd}`);
	}

	if (prices.usdFoil) {
		segments.push(`$${prices.usdFoil} ${settings.foilPriceSuffix}`);
	}

	if (prices.usdEtched) {
		segments.push(`$${prices.usdEtched} ${settings.etchedPriceSuffix}`);
	}

	if (segments.length > 0) {
		return segments.join(" | ");
	}

	if (prices.eur) {
		return `EUR ${prices.eur}`;
	}

	if (prices.eurFoil) {
		return `EUR ${prices.eurFoil} ${settings.foilPriceSuffix}`;
	}

	if (prices.tix) {
		return `${prices.tix} tix`;
	}

	return null;
}

function normalizeLegalityStatus(status: string | undefined): DisplayLegalityStatus | null {
	switch (status) {
		case "legal":
			return "legal";
		case "banned":
			return "banned";
		case "restricted":
			return "restricted";
		default:
			return null;
	}
}

function renderLegalitySection(container: HTMLElement, result: CardPreviewResult): void {
	const legalities = result.card?.legalities;
	if (!legalities) {
		return;
	}

	const formats = POPOVER_LEGALITY_FORMATS
		.map(({ key, label }) => {
			const status = normalizeLegalityStatus(legalities[key]);
			return status ? { label, status } : null;
		})
		.filter((entry): entry is { label: string; status: DisplayLegalityStatus } => entry !== null);

	if (formats.length === 0) {
		return;
	}

	const section = container.createEl("div", { cls: "mtg-card-popover-legalities" });
	section.createEl("p", {
		text: "Legality",
		cls: "mtg-card-popover-section-title",
	});

	const grid = section.createEl("div", { cls: "mtg-card-popover-legality-grid" });
	for (const format of formats) {
		const pill = grid.createEl("span", {
			text: format.label,
			cls: `mtg-card-popover-legality-pill is-${format.status}`,
		});
		pill.setAttribute("aria-label", `${format.label}: ${format.status}`);
	}
}

export class MtgPopover {
	private el: HTMLElement;
	private hideTimer: number | null = null;
	private triggerActive = false;
	private popoverActive = false;

	constructor() {
		this.el = document.createElement("div");
		this.el.className = "mtg-card-popover";
		this.el.addEventListener("mouseenter", () => {
			this.popoverActive = true;
			this.cancelHide();
		});
		this.el.addEventListener("mouseleave", () => {
			this.popoverActive = false;
			this.scheduleHide();
		});
		document.body.appendChild(this.el);
	}

	showLoading(x: number, y: number): void {
		this.cancelHide();
		this.el.empty();
		this.el.createEl("p", { text: "Loading card preview…", cls: "mtg-card-popover-message" });
		this.el.addClass("is-visible");
		this.position(x, y);
	}

	showResult(x: number, y: number, result: CardPreviewResult, settings: MTGSettings): void {
		this.cancelHide();
		this.el.empty();

		if (result.status === "success" && result.imageSrc) {
			const img = this.el.createEl("img", { cls: "mtg-card-popover-img" });
			img.src = result.imageSrc;
			img.alt = `${result.cardName} card preview`;
			img.style.maxWidth = `${settings.maxImageWidth}px`;

			const price = formatCardPrice(result, settings);
			if (price) {
				this.el.createEl("p", {
					text: price,
					cls: "mtg-card-popover-price",
				});
			}

			renderLegalitySection(this.el, result);
		} else {
			this.el.createEl("p", {
				text: result.message ?? "Card preview unavailable.",
				cls: "mtg-card-popover-message",
			});
		}

		this.el.addClass("is-visible");
		this.position(x, y);
	}

	activateTrigger(): void {
		this.triggerActive = true;
		this.cancelHide();
	}

	deactivateTrigger(): void {
		this.triggerActive = false;
		this.scheduleHide();
	}

	hide(force = false): void {
		if (!force && (this.triggerActive || this.popoverActive)) {
			return;
		}

		this.cancelHide();
		this.el.removeClass("is-visible");
	}

	destroy(): void {
		this.hide(true);
		this.el.remove();
	}

	private position(x: number, y: number): void {
		const margin = 16;
		let left = x + 15;
		let top = y + 15;

		this.el.setCssProps({
			left: "0px",
			top: "0px",
		});
		const rect = this.el.getBoundingClientRect();

		if (left + rect.width + margin > window.innerWidth) {
			left = x - rect.width - 15;
		}

		if (top + rect.height + margin > window.innerHeight) {
			top = y - rect.height - 15;
		}

		const boundedLeft = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));
		const boundedTop = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));
		this.el.setCssProps({
			left: `${boundedLeft}px`,
			top: `${boundedTop}px`,
		});
	}

	private scheduleHide(): void {
		this.cancelHide();
		this.hideTimer = window.setTimeout(() => {
			this.hideTimer = null;
			this.hide();
		}, 120);
	}

	private cancelHide(): void {
		if (this.hideTimer !== null) {
			window.clearTimeout(this.hideTimer);
			this.hideTimer = null;
		}
	}
}

export function attachHoverEvents(
	el: HTMLElement,
	cardName: string,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): void {
	let requestToken = 0;

	const resolveAndShow = async (x: number, y: number): Promise<void> => {
		const currentToken = ++requestToken;
		popover.activateTrigger();
		popover.showLoading(x, y);

		const result = await cache.resolveCard(cardName);
		if (currentToken !== requestToken) {
			return;
		}

		popover.showResult(x, y, result, getSettings());
	};

	el.addEventListener("mouseenter", (event: MouseEvent) => {
		void resolveAndShow(event.clientX, event.clientY);
	});

	el.addEventListener("mouseleave", () => {
		requestToken += 1;
		popover.deactivateTrigger();
	});

	el.addEventListener("focus", () => {
		const rect = el.getBoundingClientRect();
		void resolveAndShow(rect.left, rect.bottom + 5);
	});

	el.addEventListener("blur", () => {
		requestToken += 1;
		popover.deactivateTrigger();
	});
}

function createCardSpan(
	cardName: string,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): HTMLElement {
	const span = document.createElement("span");
	span.className = "mtg-card-ref";
	span.textContent = cardName;
	span.tabIndex = 0;
	span.setAttribute("role", "button");
	span.setAttribute("aria-label", `Show Magic card preview for ${cardName}`);
	attachHoverEvents(span, cardName, cache, getSettings, popover);
	return span;
}

function replaceTextNodes(
	el: HTMLElement,
	regex: RegExp,
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): void {
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node): number {
			let parent: Node | null = node.parentNode;
			while (parent && parent !== el) {
				const element = parent as Element;
				const tag = element.tagName;
				if (tag === "CODE" || tag === "PRE") {
					return NodeFilter.FILTER_REJECT;
				}
				if (element.classList?.contains("mtg-card-ref")) {
					return NodeFilter.FILTER_REJECT;
				}
				parent = parent.parentNode;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const textNodes: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode()) !== null) {
		textNodes.push(node as Text);
	}

	for (const textNode of textNodes) {
		const text = textNode.textContent ?? "";
		regex.lastIndex = 0;
		if (!regex.test(text)) continue;

		regex.lastIndex = 0;
		const parent = textNode.parentNode;
		if (!parent) continue;

		const fragment = document.createDocumentFragment();
		let lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(text)) !== null) {
			const matchIndex = match.index;
			const matchLength = match[0]?.length ?? 0;
			const cardName = match[1]?.trim() ?? "";
			if (!cardName) continue;

			if (matchIndex > lastIndex) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
			}

			fragment.appendChild(createCardSpan(cardName, cache, getSettings, popover));
			lastIndex = matchIndex + matchLength;
		}

		if (lastIndex < text.length) {
			fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
		}

		parent.replaceChild(fragment, textNode);
	}
}

export function buildReadingViewProcessor(
	cache: CardCache,
	getSettings: () => MTGSettings,
	popover: MtgPopover
): (el: HTMLElement) => void {
	return (el: HTMLElement): void => {
		const settings = getSettings();
		if (!settings.enableReadingView) return;

		const regex = buildCardReferenceRegex(settings.cardPrefix);
		replaceTextNodes(el, regex, cache, getSettings, popover);
	};
}
