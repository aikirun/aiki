import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

import { btnPrimary, card, primaryHover } from "./ui";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		// biome-ignore lint/suspicious/noConsole: intentional error logging
		console.error("ErrorBoundary caught an error:", error, errorInfo);
	}

	handleReload = () => {
		window.location.reload();
	};

	render() {
		if (this.state.hasError) {
			return (
				<div
					style={{
						minHeight: "100vh",
						background: "var(--bg)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: 16,
					}}
				>
					<div style={{ ...card, padding: 32, maxWidth: 440, width: "100%", textAlign: "center" }}>
						<h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: "-0.038em", color: "var(--t0)" }}>
							Something went wrong
						</h1>
						<p style={{ margin: "10px 0 22px", fontSize: 14, lineHeight: 1.6, color: "var(--t2)" }}>
							An unexpected error occurred. Reload the page to try again.
						</p>
						{this.state.error && (
							<pre
								style={{
									background: "var(--code-bg)",
									border: "1px solid var(--code-border)",
									borderRadius: "var(--r-panel)",
									padding: "12px 14px",
									margin: "0 0 22px",
									fontFamily: "var(--mono)",
									fontSize: 11.5,
									lineHeight: 1.7,
									textAlign: "left",
									color: "var(--on-code-red)",
									overflowX: "auto",
								}}
							>
								{this.state.error.message}
							</pre>
						)}
						<button type="button" onClick={this.handleReload} style={btnPrimary()} {...primaryHover}>
							<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							Reload Page
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
