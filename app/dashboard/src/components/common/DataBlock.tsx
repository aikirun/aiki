import type { ReactNode } from "react";

import { CopyButton } from "./CopyButton";
import { eyebrow } from "./ui";

export type CodeLang = "json" | "ts";

const KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"default",
	"do",
	"else",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"from",
	"function",
	"if",
	"implements",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"of",
	"readonly",
	"return",
	"static",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"var",
	"void",
	"while",
	"yield",
]);

const DECLARATORS = new Set(["const", "let", "var", "function", "class", "interface", "type"]);

/** Comment, string (any quote style), number, or identifier. Anything else is punctuation. */
const TOKEN =
	/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;

function nextNonSpace(text: string, from: number): string {
	let i = from;
	while (i < text.length && /\s/.test(text[i])) i += 1;
	return text[i] ?? "";
}

function prevWord(text: string, before: number): string {
	const head = text.slice(0, before).trimEnd();
	const m = head.match(/([A-Za-z_$][\w$]*)$/);
	return m ? m[1] : "";
}

/**
 * Colours a snippet with the marketing site's syntax palette. Deliberately small:
 * it labels tokens well enough for a reader to scan a payload or a usage example,
 * and never tries to be a parser.
 */
function highlight(text: string): ReactNode[] {
	const out: ReactNode[] = [];
	let last = 0;
	let i = 0;

	TOKEN.lastIndex = 0;
	let match = TOKEN.exec(text);
	while (match !== null) {
		if (match.index > last) out.push(text.slice(last, match.index));

		const [full, comment, str, num, ident] = match;
		const after = nextNonSpace(text, match.index + full.length);
		let color: string | undefined;

		if (comment !== undefined) {
			color = "var(--code-comment)";
		} else if (str !== undefined) {
			// A string followed by a colon is an object key.
			color = after === ":" ? "var(--code-key)" : "var(--code-str)";
		} else if (num !== undefined) {
			color = "var(--code-str)";
		} else if (ident !== undefined) {
			if (KEYWORDS.has(ident)) color = "var(--code-kw)";
			else if (after === "(" || after === ":" || DECLARATORS.has(prevWord(text, match.index)))
				color = "var(--code-key)";
		}

		out.push(
			color === undefined ? (
				full
			) : (
				<span key={`t${i}`} style={{ color }}>
					{full}
				</span>
			)
		);

		last = match.index + full.length;
		i += 1;
		match = TOKEN.exec(text);
	}

	if (last < text.length) out.push(text.slice(last));
	return out;
}

function looksLikeCode(text: string): boolean {
	const t = text.trimStart();
	return t.startsWith("{") || t.startsWith("[") || t.startsWith('"');
}

/**
 * Run payloads and usage snippets render on the same dark panel the marketing site
 * uses for code, with the same syntax palette — in both themes, because this is
 * machine text either way.
 *
 * `tone` colours the label and any unhighlighted body (an error message). Code always
 * gets syntax colours; an outcome is carried by the label instead.
 */
export function DataBlock({
	label,
	text,
	tone,
	lang,
}: {
	label?: string;
	text: string;
	tone?: string;
	lang?: CodeLang;
}) {
	const highlighted = lang !== undefined || looksLikeCode(text);

	return (
		<div>
			{label && <div style={{ ...eyebrow(tone ?? "var(--t3)"), marginBottom: 7 }}>{label}</div>}
			<div
				style={{
					position: "relative",
					background: "var(--code-bg)",
					border: "1px solid var(--code-border)",
					borderRadius: "var(--r-panel)",
					padding: "14px 16px",
					overflowX: "auto",
				}}
			>
				<div style={{ position: "absolute", top: 8, right: 8 }}>
					<CopyButton text={text} onDark />
				</div>
				<pre
					style={{
						fontFamily: "var(--mono)",
						fontSize: 11.5,
						color: highlighted ? "var(--code-fg)" : (tone ?? "var(--code-fg)"),
						lineHeight: 1.75,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
						paddingRight: 24,
					}}
				>
					{highlighted ? highlight(text) : text}
				</pre>
			</div>
		</div>
	);
}
