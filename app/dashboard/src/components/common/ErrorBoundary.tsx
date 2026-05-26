import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

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
				<div className="min-h-screen bg-surface-bg flex items-center justify-center p-4">
					<div className="bg-surface-s1 border border-surface-s3 rounded-xl p-8 max-w-md w-full text-center">
						<h1 className="text-2xl font-bold text-t-0 mb-2">Something went wrong</h1>
						<p className="text-t-2 mb-6">An unexpected error occurred. Please try reloading the page.</p>
						{this.state.error && (
							<pre className="bg-surface-s2 rounded-lg p-3 text-xs text-left text-status-failed mb-6 overflow-x-auto">
								{this.state.error.message}
							</pre>
						)}
						<button
							type="button"
							onClick={this.handleReload}
							style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium hover:opacity-90 transition-opacity"
						>
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
