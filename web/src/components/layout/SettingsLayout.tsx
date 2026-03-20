import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";

const TABS = [
	{ to: "api-keys", label: "API Keys" },
	{ to: "organization", label: "Organization" },
] as const;

export function SettingsLayout() {
	const { activeOrganization, activeNamespace } = useAuth();

	return (
		<div style={{ maxWidth: 640, padding: "32px 0" }}>
			{/* Page header */}
			<div>
				<h1
					style={{
						fontSize: 18,
						fontWeight: 800,
						color: "var(--t0)",
						letterSpacing: "-0.03em",
						lineHeight: 1.2,
					}}
				>
					Settings
				</h1>
				<p
					style={{
						fontSize: 11,
						fontFamily: "IBM Plex Mono, ui-monospace, monospace",
						color: "var(--t3)",
						marginTop: 4,
					}}
				>
					{activeOrganization?.name} / {activeNamespace?.name}
				</p>
			</div>

			{/* Tab bar */}
			<div
				style={{
					display: "flex",
					gap: 0,
					borderBottom: "1px solid var(--b0)",
					marginTop: 24,
					marginBottom: 0,
				}}
			>
				{TABS.map((tab) => (
					<TabLink key={tab.to} to={tab.to} label={tab.label} />
				))}
			</div>

			{/* Tab content */}
			<Outlet />
		</div>
	);
}

function TabLink({ to, label }: { to: string; label: string }) {
	const [hovered, setHovered] = useState(false);

	return (
		<NavLink
			to={to}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={({ isActive }) => ({
				padding: "10px 16px",
				fontSize: 13,
				fontWeight: 600,
				color: isActive ? "var(--t0)" : "var(--t2)",
				textDecoration: "none",
				borderBottom: isActive ? "2px solid var(--t0)" : "2px solid transparent",
				marginBottom: -1,
				background: hovered && !isActive ? "var(--s1)" : "transparent",
				borderRadius: "6px 6px 0 0",
				transition: "color 120ms, background 120ms",
			})}
		>
			{label}
		</NavLink>
	);
}
