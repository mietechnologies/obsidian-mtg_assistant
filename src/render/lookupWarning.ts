export function createRateLimitWarning(
	message: string | undefined,
	onClick?: () => void | Promise<void>
): HTMLElement {
	const warning = document.createElement(onClick ? "button" : "span");
	warning.className = "mtg-card-warning";
	warning.textContent = "⚠️";
	warning.setAttribute(
		"aria-label",
		onClick ? "Retry rate-limited card lookup" : "Card lookup was rate limited"
	);
	warning.title = onClick
		? `${message ?? "Card lookup was rate limited."} Click to retry once.`
		: (message ?? "Card lookup was rate limited.");
	if (warning instanceof HTMLButtonElement) {
		warning.type = "button";
		warning.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			void onClick?.();
		});
	}
	return warning;
}
