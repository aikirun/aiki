import { Outlet, useLocation } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { useAuth } from "../../auth/AuthProvider";
import { btnPrimary, card, primaryHover } from "../common/ui";

function NoNamespaceAccess() {
	const { activeOrganization, refreshNamespaces } = useAuth();

	return (
		<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
			<div style={{ ...card, textAlign: "center", maxWidth: 420, padding: "36px 32px" }}>
				<h2 style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--t0)", margin: "0 0 8px" }}>
					No namespaces available
				</h2>
				<p style={{ fontSize: 13.5, color: "var(--t2)", lineHeight: 1.6, margin: "0 0 20px" }}>
					You don't have access to any namespaces in{" "}
					<strong style={{ color: "var(--t0)", fontWeight: 600 }}>{activeOrganization?.name}</strong>. Ask an
					organization admin to add you to a namespace.
				</p>
				<button type="button" onClick={() => refreshNamespaces()} style={btnPrimary()} {...primaryHover}>
					Refresh
				</button>
			</div>
		</div>
	);
}

export function AppShell() {
	const { activeNamespace } = useAuth();
	const location = useLocation();
	const isSettingsRoute = location.pathname.startsWith("/settings");

	return (
		<div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
			<Sidebar />
			<main className="app-canvas" style={{ flex: 1, overflowY: "auto" }}>
				{activeNamespace || isSettingsRoute ? (
					<div style={{ maxWidth: 780, margin: "0 auto", padding: "28px 32px 64px" }}>
						<Outlet />
					</div>
				) : (
					<NoNamespaceAccess />
				)}
			</main>
		</div>
	);
}
