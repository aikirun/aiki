import { RootProvider } from "fumadocs-ui/provider/react-router";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useMatches } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

import NotFound from "./routes/not-found";

export const links: Route.LinksFunction = () => [
	{ rel: "icon", href: "/assets/aiki-favicon.svg", type: "image/svg+xml" },
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	// The /404 route exists only to be prerendered into the static 404.html
	// (postbuild renames it), which the static host serves for any unmatched
	// URL. It must not hydrate: booting the router against a URL that matches a
	// real route pattern renders the wrong view. Omitting the scripts keeps the
	// page fully static; its links are plain navigation. (The prerenderer
	// requests the page at "/404/", so the route is recognized by its id.)
	const staticNotFound = useMatches().some((match) => match.id === "not-found-404");

	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body className="flex flex-col min-h-screen">
				<RootProvider
					search={{
						// Static, in-browser search: the default dialog downloads the
						// prerendered Orama index from `/api/search` (staticGET output)
						// and queries it client-side. No server search route at runtime.
						options: { type: "static" },
					}}
				>
					{children}
				</RootProvider>
				{!staticNotFound && <ScrollRestoration />}
				{!staticNotFound && <Scripts />}
			</body>
		</html>
	);
}

export default function App() {
	return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	// A 404 surfaced during client rendering shows the not-found page. (Mistyped
	// URLs are served the static 404.html and rarely reach here.)
	if (isRouteErrorResponse(error) && error.status === 404) {
		return <NotFound />;
	}

	// Any other error is a genuine failure, shown as such — with a stack trace in
	// development.
	const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;
	const detail = isRouteErrorResponse(error)
		? error.statusText || "Request failed"
		: import.meta.env.DEV && error instanceof Error
			? error.message
			: "An unexpected error occurred. Please try again.";

	return (
		<main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
			<h1 className="font-semibold text-2xl">Something went wrong</h1>
			<p className="max-w-md text-fd-muted-foreground">{detail}</p>
			{stack && (
				<pre className="w-full max-w-3xl overflow-x-auto p-4 text-left text-sm">
					<code>{stack}</code>
				</pre>
			)}
		</main>
	);
}
