import { CopyButton } from "./CopyButton";

export function DataBlock({ label, text, color = "var(--t1)" }: { label?: string; text: string; color?: string }) {
	return (
		<div>
			{label && (
				<div
					style={{
						fontSize: 9,
						fontWeight: 700,
						textTransform: "uppercase",
						letterSpacing: "0.07em",
						color: "var(--t3)",
						marginBottom: 6,
					}}
				>
					{label}
				</div>
			)}
			<div
				style={{
					position: "relative",
					background: "var(--s1)",
					border: "1px solid var(--b0)",
					borderRadius: 8,
					padding: "12px 14px",
				}}
			>
				<div style={{ position: "absolute", top: 8, right: 8 }}>
					<CopyButton text={text} />
				</div>
				<pre
					style={{
						fontFamily: "var(--mono)",
						fontSize: 11,
						color,
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						margin: 0,
						paddingRight: 24,
					}}
				>
					{text}
				</pre>
			</div>
		</div>
	);
}
