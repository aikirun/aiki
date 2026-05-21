import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface AuthLayoutProps {
	children: ReactNode;
	title: string;
	subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
	return (
		<div
			style={{
				minHeight: "100vh",
				background: "var(--bg)",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "48px 16px",
			}}
		>
			<Link to="/" style={{ marginBottom: 32, textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
				<svg viewBox="0 0 100 100" style={{ width: 36, height: 36 }}>
					<defs>
						<linearGradient id="authLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
							<stop offset="0%" stopColor="#667eea" />
							<stop offset="50%" stopColor="#764ba2" />
							<stop offset="100%" stopColor="#f093fb" />
						</linearGradient>
					</defs>
					<g transform="translate(-11.25, 0)">
						<path
							d="M50 5 A45 45 0 0 1 50 95 A22.5 22.5 0 0 1 50 50 A22.5 22.5 0 0 0 50 5 Z"
							fill="url(#authLogoGrad)"
						/>
						<circle cx="50" cy="72.5" r="9" fill="var(--bg)" />
					</g>
				</svg>
				<span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--t0)" }}>aiki</span>
			</Link>

			<div style={{ width: "100%", maxWidth: 400 }}>
				<div
					style={{
						background: "var(--s1)",
						border: "1px solid var(--b0)",
						borderRadius: 12,
						padding: 32,
					}}
				>
					<div style={{ textAlign: "center", marginBottom: 28 }}>
						<h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--t0)", letterSpacing: "-0.03em" }}>{title}</h1>
						{subtitle && <p style={{ marginTop: 8, fontSize: 13, color: "var(--t2)" }}>{subtitle}</p>}
					</div>
					{children}
				</div>
			</div>
		</div>
	);
}
