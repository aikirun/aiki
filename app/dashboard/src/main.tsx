import type { Capabilities } from "@aikirun/server/capabilities";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { CapabilitiesProvider } from "./capabilities/CapabilitiesProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AIKI_SERVER_URL } from "./config";
import "./index.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 10_000,
			refetchOnWindowFocus: false,
			retry: (failureCount, error) => {
				if (error instanceof Error && "status" in error && typeof error.status === "number") {
					if (error.status >= 400 && error.status < 500) {
						return false;
					}
				}
				return failureCount < 3;
			},
		},
	},
});

async function loadCapabilities(): Promise<Capabilities> {
	const response = await fetch(`${AIKI_SERVER_URL}/capabilities`);
	if (!response.ok) {
		throw new Error(`Failed to load capabilities: HTTP ${response.status}`);
	}
	return response.json();
}

function CapabilitiesError({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<div
			style={{
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 24,
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<div style={{ maxWidth: 420, textAlign: "center" }}>
				<h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Unable to reach Aiki server</h1>
				<p style={{ fontSize: 13, color: "#888", lineHeight: 1.5, marginBottom: 12 }}>
					Could not load server capabilities from <code>{AIKI_SERVER_URL}</code>
				</p>
				<p style={{ fontSize: 13, color: "#888", lineHeight: 1.5, marginBottom: 16 }}>
					When this dashboard is on a different origin from the server, ensure the dashboard is built with{" "}
					<code>VITE_AIKI_SERVER_URL</code> set to the server's URL, and the server's <code>CORS_ORIGINS</code> allows
					this dashboard's origin.
				</p>
				<pre
					style={{
						fontSize: 11,
						background: "#f5f5f5",
						padding: 8,
						borderRadius: 4,
						color: "#444",
						overflow: "auto",
						textAlign: "left",
						display: "inline-block",
						maxWidth: "100%",
						margin: 0,
					}}
				>
					{message}
				</pre>
			</div>
		</div>
	);
}

// biome-ignore lint/style/noNonNullAssertion: root element is guaranteed to exist
const root = createRoot(document.getElementById("root")!);

loadCapabilities().then(
	(capabilities) => {
		root.render(
			<StrictMode>
				<ErrorBoundary>
					<CapabilitiesProvider value={capabilities}>
						<QueryClientProvider client={queryClient}>
							<BrowserRouter>
								<AuthProvider>
									<App />
								</AuthProvider>
							</BrowserRouter>
						</QueryClientProvider>
					</CapabilitiesProvider>
				</ErrorBoundary>
			</StrictMode>
		);
	},
	(error) => {
		root.render(<CapabilitiesError error={error} />);
	}
);
