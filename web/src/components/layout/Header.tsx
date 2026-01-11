import { Link } from "react-router-dom";

export function Header() {
	return (
		<header className="bg-white border-b-2 border-slate-200">
			<div className="max-w-7xl mx-auto px-6 py-4">
				<div className="flex items-center justify-between">
					<Link to="/" className="flex items-center">
						<svg viewBox="0 0 195 60" className="h-8 w-auto">
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
					<nav className="flex items-center gap-4">
						<a
							href="https://github.com/aikirun/aiki"
							target="_blank"
							rel="noopener noreferrer"
							className="text-slate-500 hover:text-slate-700 transition-colors"
						>
							<svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
								<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
							</svg>
						</a>
					</nav>
				</div>
			</div>
		</header>
	);
}
