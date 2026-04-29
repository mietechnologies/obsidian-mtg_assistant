import blackGreenSvg from "../img/black+green.svg";
import blackRedSvg from "../img/black+red.svg";
import blueBlackSvg from "../img/blue+black.svg";
import blueRedSvg from "../img/blue+red.svg";
import greenBlueSvg from "../img/green+blue.svg";
import greenWhiteSvg from "../img/green+white.svg";
import redGreenSvg from "../img/red+green.svg";
import redWhiteSvg from "../img/red+white.svg";
import whiteBlackSvg from "../img/white+black.svg";
import whiteBlueSvg from "../img/white+blue.svg";
import zeroSvg from "../img/0.svg";
import oneSvg from "../img/1.svg";
import twoSvg from "../img/2.svg";
import threeSvg from "../img/3.svg";
import fourSvg from "../img/4.svg";
import fiveSvg from "../img/5.svg";
import sixSvg from "../img/6.svg";
import sevenSvg from "../img/7.svg";
import eightSvg from "../img/8.svg";
import nineSvg from "../img/9.svg";
import blackSvg from "../img/black.svg";
import blueSvg from "../img/blue.svg";
import colorlessSvg from "../img/colorless.svg";
import greenSvg from "../img/green.svg";
import redSvg from "../img/red.svg";
import snowSvg from "../img/snow.svg";
import whiteSvg from "../img/white.svg";
import xSvg from "../img/x.svg";

const MANA_SYMBOL_SVGS: Record<string, string> = {
	"0": zeroSvg,
	"1": oneSvg,
	"2": twoSvg,
	"3": threeSvg,
	"4": fourSvg,
	"5": fiveSvg,
	"6": sixSvg,
	"7": sevenSvg,
	"8": eightSvg,
	"9": nineSvg,
	X: xSvg,
	W: whiteSvg,
	U: blueSvg,
	B: blackSvg,
	R: redSvg,
	G: greenSvg,
	C: colorlessSvg,
	S: snowSvg,
	"W/U": whiteBlueSvg,
	"U/B": blueBlackSvg,
	"B/R": blackRedSvg,
	"R/G": redGreenSvg,
	"G/W": greenWhiteSvg,
	"W/B": whiteBlackSvg,
	"U/R": blueRedSvg,
	"B/G": blackGreenSvg,
	"R/W": redWhiteSvg,
	"G/U": greenBlueSvg,
};

function createSvgElement(svgMarkup: string): SVGElement | null {
	const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
	const svg = doc.documentElement;
	return svg instanceof SVGElement ? svg : null;
}

function createManaSymbol(symbol: string): HTMLElement | SVGElement {
	const normalized = symbol.toUpperCase();
	const svgMarkup = MANA_SYMBOL_SVGS[normalized];
	if (!svgMarkup) {
		const fallback = document.createElement("span");
		fallback.className = "mtg-mana-symbol is-fallback";
		fallback.textContent = normalized;
		return fallback;
	}

	const svg = createSvgElement(svgMarkup);
	if (!svg) {
		const fallback = document.createElement("span");
		fallback.className = "mtg-mana-symbol is-fallback";
		fallback.textContent = normalized;
		return fallback;
	}

	svg.classList.add("mtg-mana-symbol");
	svg.setAttribute("aria-hidden", "true");
	return svg;
}

function parseManaCost(cost: string): string[] {
	return Array.from(cost.matchAll(/\{([^}]+)\}/g)).map((match) => match[1] ?? "");
}

function normalizeManaCosts(costs: string[]): string[] {
	return costs
		.flatMap((cost) => cost.split(/\s*\/\/\s*/))
		.map((cost) => cost.trim())
		.filter((cost) => cost.length > 0);
}

export function createManaCostElement(costs: string[] | undefined): HTMLElement {
	const container = document.createElement("div");
	container.className = "mtg-mana-cost";

	if (!costs || costs.length === 0) {
		container.textContent = "—";
		return container;
	}

	normalizeManaCosts(costs).forEach((cost, index) => {
		if (index > 0) {
			container.createEl("span", {
				text: "//",
				cls: "mtg-mana-cost-separator",
			});
		}

		const row = container.createEl("span", { cls: "mtg-mana-cost-row" });
		const symbols = parseManaCost(cost);
		if (symbols.length === 0) {
			row.textContent = cost;
			return;
		}

		for (const symbol of symbols) {
			row.appendChild(createManaSymbol(symbol));
		}
	});

	return container;
}
