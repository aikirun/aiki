/**
 * Post-build: produce build/client/404.html.
 *
 * React Router emits no 404.html, but a static host needs one — without it the
 * host serves index.html (the marketing page) with a 200 for every unmatched
 * URL. The `/404` route (see routes.ts) is prerendered only to produce this
 * file; here we rename it to 404.html and strip its scripts so it is a plain
 * static page. Everything else — the marketing page at `/` (public/index.html)
 * and the prerendered routes — Vite and React Router emit directly.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const clientDir = join(root, "build", "client");

const nested404 = join(clientDir, "404", "index.html");
const flat404 = join(clientDir, "404.html");
if (existsSync(nested404)) {
	renameSync(nested404, flat404);
	rmSync(join(clientDir, "404"), { recursive: true, force: true });
	// Strip the client-bundle scripts so 404.html is a plain static page. It is
	// served for any unmatched URL, including ones under docs/*; with no scripts
	// there is no hydration, so it renders as-is and its links are plain
	// navigation. (Bad in-app navigations are handled by the root ErrorBoundary.)
	writeFileSync(flat404, readFileSync(flat404, "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""));
	console.log("wrote build/client/404.html (static, no hydration)");
} else if (existsSync(flat404)) {
	console.log("build/client/404.html already present");
} else {
	throw new Error("no prerendered /404 shell found — check routes.ts and the prerender config");
}
