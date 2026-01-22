import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface AuthLayoutProps {
	children: ReactNode;
	title: string;
	subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
	return (
		<div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
			<Link to="/" className="mb-8">
				<svg viewBox="0 0 195 60" className="h-12 w-auto">
					<defs>
						<linearGradient id="aikiGradientMark" x1="0%" y1="0%" x2="100%" y2="100%">
							<stop offset="0%" stopColor="#667eea" />
							<stop offset="50%" stopColor="#764ba2" />
							<stop offset="100%" stopColor="#f093fb" />
						</linearGradient>
						<linearGradient id="aikiGradientText" x1="0%" y1="0%" x2="100%" y2="0%">
							<stop offset="0%" stopColor="#667eea" />
							<stop offset="50%" stopColor="#764ba2" />
							<stop offset="100%" stopColor="#f093fb" />
						</linearGradient>
					</defs>
					<g transform="translate(5, 5)">
						<path
							d="M25 2.5 A22.5 22.5 0 0 1 25 47.5 A11.25 11.25 0 0 1 25 25 A11.25 11.25 0 0 0 25 2.5 Z"
							fill="url(#aikiGradientMark)"
						/>
						<circle cx="25" cy="36.25" r="4.5" fill="white" />
					</g>
					<text
						x="58"
						y="43"
						fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
						fontSize="42"
						fontWeight="700"
						letterSpacing="-1.5"
						fill="url(#aikiGradientText)"
					>
						aiki
					</text>
				</svg>
			</Link>

			<div className="w-full max-w-md">
				<div className="bg-white rounded-2xl border-2 border-slate-200 p-8">
					<div className="text-center mb-8">
						<h1 className="text-2xl font-bold text-slate-900">{title}</h1>
						{subtitle && <p className="mt-2 text-slate-600">{subtitle}</p>}
					</div>
					{children}
				</div>
			</div>
		</div>
	);
}
