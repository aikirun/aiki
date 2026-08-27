import { Link } from "react-router-dom";

import { btnPrimary, eyebrow, primaryHover } from "./ui";

interface NotFoundProps {
	title?: string;
	message?: string;
}

export function NotFound({
	title = "Page Not Found",
	message = "The page you're looking for doesn't exist or has been moved.",
}: NotFoundProps) {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "88px 16px",
				textAlign: "center",
			}}
		>
			<div style={{ ...eyebrow(), marginBottom: 14 }}>404</div>
			<h1 style={{ margin: 0, fontSize: 34, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--t0)" }}>
				{title}
			</h1>
			<p style={{ margin: "10px 0 26px", maxWidth: 420, fontSize: 14.5, lineHeight: 1.6, color: "var(--t2)" }}>
				{message}
			</p>
			<Link to="/" style={{ ...btnPrimary(), textDecoration: "none" }} {...primaryHover}>
				<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				Back to Runs
			</Link>
		</div>
	);
}
