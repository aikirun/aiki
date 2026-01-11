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
				<div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
					<div className="bg-white rounded-2xl border-2 border-slate-200 p-8 max-w-md w-full text-center">
						<div className="text-6xl mb-4">💥</div>
						<h1 className="text-2xl font-bold text-slate-900 mb-2">Something went wrong</h1>
						<p className="text-slate-500 mb-6">An unexpected error occurred. Please try reloading the page.</p>
						{this.state.error && (
							<pre className="bg-slate-100 rounded-lg p-3 text-xs text-left text-red-600 mb-6 overflow-x-auto">
								{this.state.error.message}
							</pre>
						)}
						<button
							type="button"
							onClick={this.handleReload}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aiki-purple text-white font-medium hover:bg-purple-700 transition-colors"
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
