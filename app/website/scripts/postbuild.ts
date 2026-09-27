/**
 * Post-build: produce build/client/404.html.
 *
 * React Router emits no 404.html, but a static host needs one — without it the
 * host serves index.html (the marketing page) with a 200 for every unmatched
 * URL. The `/404` route (see routes.ts) is prerendered only to produce this
 * file — rendered without scripts (see root.tsx) so it stays a plain static
 * page — and here we rename it to 404.html. Everything else — the marketing
 * page at `/` (public/index.html) and the prerendered routes — Vite and React
 * Router emit directly.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
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
	console.log("wrote build/client/404.html");
} else if (existsSync(flat404)) {
	console.log("build/client/404.html already present");
} else {
	throw new Error("no prerendered /404 shell found — check routes.ts and the prerender config");
}
