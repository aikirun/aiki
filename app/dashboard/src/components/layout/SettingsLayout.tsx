import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthProvider";
import { eyebrow } from "../common/ui";

export function SettingsLayout() {
	const { activeOrganization, activeNamespace } = useAuth();
	const location = useLocation();
	const navigate = useNavigate();

	const isNamespaceAdmin = activeNamespace?.role === "admin";

	const tabs = [
		...(isNamespaceAdmin ? [{ to: "api-keys", label: "API Keys" }] : []),
		{ to: "organization", label: "Organization" },
	];

	// Redirect away from api-keys if the user is no longer an admin (e.g. after org switch)
	useEffect(() => {
		if (!isNamespaceAdmin && location.pathname.includes("/settings/api-keys")) {
			navigate("/settings/organization", { replace: true });
		}
	}, [isNamespaceAdmin, location.pathname, navigate]);

	return (
		<div style={{ maxWidth: 720, padding: "6px 0 0" }}>
			{/* Page header */}
			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				<span style={eyebrow()}>
					{activeOrganization?.name} / {activeNamespace?.name}
				</span>
				<h1
					style={{
						margin: 0,
						fontSize: 30,
						fontWeight: 800,
						color: "var(--t0)",
						letterSpacing: "-0.038em",
						lineHeight: 1.05,
					}}
				>
					Settings
				</h1>
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
				{tabs.map((tab) => (
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
				fontFamily: "var(--mono)",
				fontSize: 11.5,
				fontWeight: 500,
				letterSpacing: "0.02em",
				color: isActive ? "var(--accent-ink)" : hovered ? "var(--t1)" : "var(--t3)",
				textDecoration: "none",
				borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
				marginBottom: -1,
				background: "transparent",
				transition: "color .16s ease, border-color .16s ease",
			})}
		>
			{label}
		</NavLink>
	);
}
