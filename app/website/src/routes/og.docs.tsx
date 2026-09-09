import { ImageResponse } from "takumi-js/response";

import type { Route } from "./+types/og.docs";
import { source } from "@/lib/source";

const GROUND = "#f8f8f5";
const INK = "#17171a";
const MUTED = "#5c5c64";
const ACCENT = "#764ba2";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

/**
 * The docs root is titled "Introduction", which names nothing once the link leaves the site. Its
 * card carries the product line instead; the page keeps its own title and description, which would
 * otherwise repeat this title back.
 */
const ROOT_CARD_TITLE = "Durable workflows in TypeScript";
const ROOT_CARD_DESCRIPTION = "An async function that survives crashes and waits months without holding a process.";

/** Folder slugs title-case to exactly the titles in each `meta.json`, so no lookup is needed. */
function sectionLabel(slugs: string[]): string | undefined {
	const folder = slugs.length > 1 ? slugs[0] : undefined;
	return folder
		?.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function AikiMark() {
	return (
		<svg width="44" height="44" viewBox="0 0 100 100">
			<defs>
				<linearGradient id="mark" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="#667eea" />
					<stop offset="50%" stopColor="#764ba2" />
					<stop offset="100%" stopColor="#f093fb" />
				</linearGradient>
			</defs>
			<g transform="translate(-11.25, 0)">
				<path d="M50 5 A45 45 0 0 1 50 95 A22.5 22.5 0 0 1 50 50 A22.5 22.5 0 0 0 50 5 Z" fill="url(#mark)" />
				<circle cx="50" cy="72.5" r="9" fill={GROUND} />
			</g>
		</svg>
	);
}

export function loader({ params }: Route.LoaderArgs) {
	const slugs = params["*"]
		.split("/")
		.filter((v) => v.length > 0)
		.slice(0, -1);
	const page = source.getPage(slugs);

	if (!page) throw new Response(undefined, { status: 404 });

	const section = sectionLabel(slugs);
	const isRoot = slugs.length === 0;
	const title = isRoot ? ROOT_CARD_TITLE : page.data.title;
	const description = isRoot ? ROOT_CARD_DESCRIPTION : page.data.description;

	return new ImageResponse(
		<div style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", backgroundColor: GROUND }}>
			{/* The logo gradient as an edge — the one mark still legible at link-preview width. */}
			<div
				style={{
					display: "flex",
					width: "22px",
					height: "100%",
					backgroundImage: "linear-gradient(180deg, #667eea 0%, #764ba2 52%, #f093fb 100%)",
				}}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					flexGrow: 1,
					padding: "0 84px",
				}}
			>
				{section && (
					<p
						style={{
							display: "flex",
							fontFamily: MONO,
							fontSize: "22px",
							letterSpacing: "3px",
							textTransform: "uppercase",
							color: ACCENT,
							margin: "0 0 30px",
						}}
					>
						{section}
					</p>
				)}
				<p
					style={{
						display: "flex",
						fontSize: "84px",
						lineHeight: 1.04,
						letterSpacing: "-3px",
						fontWeight: 800,
						color: INK,
						margin: 0,
					}}
				>
					{title}
				</p>
				{description && (
					<p
						style={{
							display: "flex",
							fontSize: "34px",
							lineHeight: 1.4,
							color: MUTED,
							margin: "28px 0 0",
							maxWidth: "880px",
						}}
					>
						{description}
					</p>
				)}
				<div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: "16px", marginTop: "56px" }}>
					<AikiMark />
					<p
						style={{ display: "flex", fontSize: "34px", fontWeight: 700, letterSpacing: "-1px", color: INK, margin: 0 }}
					>
						aiki
					</p>
				</div>
			</div>
		</div>,
		{
			width: 1200,
			height: 630,
			format: "webp",
		}
	);
}
