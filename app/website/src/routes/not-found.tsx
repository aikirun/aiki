import { Link } from "react-router";

import type { Route } from "./+types/not-found";

export function meta(_: Route.MetaArgs) {
	return [{ title: "Not Found — Aiki" }];
}

// Prerendered into the static, script-free 404.html (see routes.ts). Without JS,
// HomeLayout's search box and theme toggle are inert, so this page is
// self-contained — plain links that navigate with or without JS.
export default function NotFound() {
	return (
		<main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
			<p className="font-bold text-5xl text-fd-muted-foreground">404</p>
			<h1 className="font-semibold text-2xl">Page not found</h1>
			<p className="max-w-md text-fd-muted-foreground">
				This page doesn't exist. Check the URL, or start from the docs.
			</p>
			<div className="flex gap-3">
				<Link to="/" className="rounded-lg border px-4 py-2 font-medium">
					Home
				</Link>
				<Link to="/docs" className="rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground">
					Docs
				</Link>
			</div>
		</main>
	);
}
