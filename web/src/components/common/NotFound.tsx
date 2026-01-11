import { Link } from "react-router-dom";

interface NotFoundProps {
	title?: string;
	message?: string;
}

export function NotFound({
	title = "Page Not Found",
	message = "The page you're looking for doesn't exist or has been moved.",
}: NotFoundProps) {
	return (
		<div className="flex flex-col items-center justify-center py-24">
			<div className="text-8xl font-bold text-slate-200 mb-4">404</div>
			<h1 className="text-2xl font-bold text-slate-900 mb-2">{title}</h1>
			<p className="text-slate-500 mb-6 text-center max-w-md">{message}</p>
			<Link
				to="/"
				className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aiki-purple text-white font-medium hover:bg-purple-700 transition-colors"
			>
				<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
				</svg>
				Back to Dashboard
			</Link>
		</div>
	);
}
