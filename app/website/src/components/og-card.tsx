const GROUND = "#f8f8f5";
const INK = "#17171a";
const MUTED = "#5c5c64";
const ACCENT = "#764ba2";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";

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

/**
 * The 1200x630 card behind every shared Aiki link. Rendered by takumi rather than a browser, so it
 * stays on flexbox and inline styles.
 */
export function OgCard({ title, description, eyebrow }: { title: string; description?: string; eyebrow?: string }) {
	return (
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
				{eyebrow && (
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
						{eyebrow}
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
		</div>
	);
}
