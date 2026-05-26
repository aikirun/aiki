import { Outlet, useLocation } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { useAuth } from "../../auth/AuthProvider";

function NoNamespaceAccess() {
	const { activeOrganization, refreshNamespaces } = useAuth();

	return (
		<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
			<div style={{ textAlign: "center", maxWidth: 400, padding: "0 16px" }}>
				<h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--t0)", marginBottom: 8 }}>No namespaces available</h2>
				<p style={{ fontSize: 13, color: "var(--t2)", lineHeight: 1.5, marginBottom: 20 }}>
					You don't have access to any namespaces in{" "}
					<strong style={{ color: "var(--t1)" }}>{activeOrganization?.name}</strong>. Ask an organization admin to add
					you to a namespace.
				</p>
				<button
					type="button"
					onClick={() => refreshNamespaces()}
					style={{
						background: "var(--s2)",
						border: "1px solid rgba(255,255,255,0.08)",
						borderRadius: 6,
						padding: "8px 16px",
						fontSize: 12,
						fontWeight: 600,
						color: "var(--t1)",
						cursor: "pointer",
						fontFamily: "inherit",
					}}
				>
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
		<div className="flex h-screen overflow-hidden bg-surface-bg">
			<Sidebar />
			<main className="flex-1 overflow-y-auto">
				{activeNamespace || isSettingsRoute ? (
					<div className="max-w-[740px] mx-auto px-6 py-6">
						<Outlet />
					</div>
				) : (
					<NoNamespaceAccess />
				)}
			</main>
		</div>
	);
}
