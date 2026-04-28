import blackSvg from "../img/black.svg";
import blueSvg from "../img/blue.svg";
import colorlessSvg from "../img/colorless.svg";
import greenSvg from "../img/green.svg";
import redSvg from "../img/red.svg";
import whiteSvg from "../img/white.svg";

const COLOR_ICON_SVGS: Record<string, string> = {
	W: whiteSvg,
	U: blueSvg,
	B: blackSvg,
	R: redSvg,
	G: greenSvg,
};

function createColorlessIcon(): SVGElement | null {
	const svg = createSvgElement(colorlessSvg);
	if (!svg) return null;

	svg.classList.add("mtg-color-identity-icon", "is-colorless");
	svg.setAttribute("aria-hidden", "true");
	return svg;
}

function createSvgElement(svgMarkup: string): SVGElement | null {
	const doc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
	const svg = doc.documentElement;
	return svg instanceof SVGElement ? svg : null;
}

export function createColorIdentityElement(colorIdentity: string[]): HTMLElement {
	const container = document.createElement("span");
	container.className = "mtg-color-identity";

	if (colorIdentity.length === 0) {
		const colorlessIcon = createColorlessIcon();
		if (colorlessIcon) {
			container.appendChild(colorlessIcon);
			return container;
		}

		container.classList.add("is-colorless");
		container.textContent = "C";
		return container;
	}

	for (const symbol of colorIdentity) {
		const svgMarkup = COLOR_ICON_SVGS[symbol];
		if (!svgMarkup) continue;

		const svg = createSvgElement(svgMarkup);
		if (!svg) continue;

		svg.classList.add("mtg-color-identity-icon");
		svg.setAttribute("aria-hidden", "true");
		container.appendChild(svg);
	}

	if (!container.hasChildNodes()) {
		const colorlessIcon = createColorlessIcon();
		if (colorlessIcon) {
			container.appendChild(colorlessIcon);
			return container;
		}

		container.classList.add("is-colorless");
		container.textContent = "C";
	}

	return container;
}
