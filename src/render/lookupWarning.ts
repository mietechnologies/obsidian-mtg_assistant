export function createInlineWarning(
	message: string | undefined,
	options?: {
		label?: string;
		symbol?: string;
		onClick?: () => void | Promise<void>;
	}
): HTMLElement {
	const warning = document.createElement(options?.onClick ? "button" : "span");
	warning.className = "mtg-card-warning";
	warning.textContent = options?.symbol ?? "⚠️";
	warning.setAttribute(
		"aria-label",
		options?.label ?? (options?.onClick ? "Card warning" : "Card warning")
	);
	warning.title = options?.onClick
		? `${message ?? "Card warning."} Click to retry once.`
		: (message ?? "Card warning.");
	if (warning instanceof HTMLButtonElement) {
		warning.type = "button";
		warning.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void options?.onClick?.();
		});
	}
	return warning;
}

export function createRateLimitWarning(
	message: string | undefined,
	onClick?: () => void | Promise<void>
): HTMLElement {
	return createInlineWarning(message, {
		label: onClick ? "Retry rate-limited card lookup" : "Card lookup was rate limited",
		symbol: "⚠️",
		onClick,
	});
}
