import type { CSSProperties } from "react";

import { edge, tint } from "../../constants/status-colors";

/**
 * The shared vocabulary the dashboard borrows from the marketing site: mono
 * eyebrows, hairline cards, a violet primary and a quiet secondary. Pages compose
 * these rather than re-deriving padding and radius each time.
 */

/** Small mono label that names a section. Uppercase, wide-tracked, accent-coloured. */
export function eyebrow(color = "var(--accent-ink)"): CSSProperties {
	return {
		fontFamily: "var(--mono)",
		fontSize: 10,
		fontWeight: 500,
		letterSpacing: "0.13em",
		textTransform: "uppercase",
		color,
	};
}

/** Muted variant for labels that sit beside a value rather than over a section. */
export function fieldLabel(): CSSProperties {
	return {
		fontFamily: "var(--mono)",
		fontSize: 9.5,
		fontWeight: 500,
		letterSpacing: "0.11em",
		textTransform: "uppercase",
		color: "var(--t3)",
	};
}

export const card: CSSProperties = {
	background: "var(--s1)",
	border: "1px solid var(--b0)",
	borderRadius: "var(--r-card)",
	boxShadow: "var(--shadow-card)",
};

/**
 * Container for a list of rows: one bordered box. Pair it with `LIST_ROWS` so the
 * rows pick up inset dividers from the stylesheet.
 */
export const cardGrid: CSSProperties = {
	background: "var(--s1)",
	border: "1px solid var(--b0)",
	borderRadius: "var(--r-card)",
	boxShadow: "var(--shadow-card)",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
};

export const LIST_ROWS = "list-rows";

const buttonBase: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	gap: 6,
	borderRadius: "var(--r-control)",
	fontFamily: "var(--sans)",
	fontSize: 12.5,
	fontWeight: 600,
	padding: "7px 14px",
	cursor: "pointer",
	whiteSpace: "nowrap",
	transition: "background-color .16s ease, border-color .16s ease, color .16s ease, box-shadow .16s ease",
};

export function btnPrimary(): CSSProperties {
	return {
		...buttonBase,
		background: "var(--accent)",
		color: "#ffffff",
		border: "1px solid transparent",
		boxShadow: "0 4px 12px -4px var(--accent-glow)",
	};
}

export function btnSecondary(): CSSProperties {
	return {
		...buttonBase,
		background: "var(--s1)",
		color: "var(--t0)",
		border: "1px solid var(--b1)",
		boxShadow: "var(--shadow-card)",
	};
}

/** Tinted button for a status-bearing action — cancel, requeue, revoke. */
export function btnTinted(color: string): CSSProperties {
	return {
		...buttonBase,
		background: tint(color),
		color,
		border: `1px solid ${edge(color)}`,
		boxShadow: "none",
	};
}

/** Small mono tag: a version, an overlap policy, a schedule cadence. */
export function chipNeutral(): CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
		background: "var(--s2)",
		color: "var(--t2)",
		border: "1px solid transparent",
		borderRadius: "var(--r-chip)",
		fontFamily: "var(--mono)",
		fontSize: 10,
		padding: "2px 6px",
		whiteSpace: "nowrap",
	};
}

/** Status-coloured chip — tinted fill, tinted edge, colour-matched text. */
export function chipStatus(color: string): CSSProperties {
	return {
		display: "inline-flex",
		alignItems: "center",
		gap: 4,
		background: tint(color),
		color,
		border: `1px solid ${edge(color)}`,
		borderRadius: "var(--r-chip)",
		fontFamily: "var(--sans)",
		fontSize: 11,
		fontWeight: 600,
		letterSpacing: "-0.005em",
		padding: "2px 8px",
		whiteSpace: "nowrap",
	};
}

/**
 * Controls are filled, not outlined. Outlines are reserved for containers, so a
 * form of eight fields reads as one panel rather than eight stacked rectangles.
 */
export const inputStyle: CSSProperties = {
	background: "var(--s2)",
	border: "1px solid transparent",
	borderRadius: "var(--r-control)",
	padding: "8px 11px",
	fontFamily: "var(--mono)",
	fontSize: 11.5,
	color: "var(--t0)",
	outline: "none",
	width: "100%",
	transition: "background-color .16s ease, border-color .16s ease, box-shadow .16s ease",
};

/** Focus/blur handlers that give a filled control the accent ring on focus. */
export const inputFocusProps = {
	onFocus: (e: { currentTarget: HTMLElement }) => {
		e.currentTarget.style.background = "var(--s1)";
		e.currentTarget.style.borderColor = "var(--accent-tint-border)";
		e.currentTarget.style.boxShadow = "0 0 0 3px var(--accent-tint)";
	},
	onBlur: (e: { currentTarget: HTMLElement }) => {
		e.currentTarget.style.background = "var(--s2)";
		e.currentTarget.style.borderColor = "transparent";
		e.currentTarget.style.boxShadow = "none";
	},
};

/** Hover/leave handlers for a button whose resting style came from the helpers above. */
function hoverSwap(enter: Partial<CSSStyleDeclaration>, leave: Partial<CSSStyleDeclaration>) {
	return {
		onMouseEnter: (e: { currentTarget: HTMLElement }) => Object.assign(e.currentTarget.style, enter),
		onMouseLeave: (e: { currentTarget: HTMLElement }) => Object.assign(e.currentTarget.style, leave),
	};
}

export const primaryHover = hoverSwap({ background: "var(--accent-hover)" }, { background: "var(--accent)" });

export const secondaryHover = hoverSwap(
	{ borderColor: "rgba(23,23,26,0.28)", color: "var(--t0)" },
	{ borderColor: "var(--b1)", color: "var(--t0)" }
);
