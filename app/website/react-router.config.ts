import { glob } from "node:fs/promises";
import type { Config } from "@react-router/dev/config";
import { createGetUrl, getSlugs } from "fumadocs-core/source";

import { getPageImagePath } from "./src/lib/og";
import { docsContentRoute } from "./src/lib/shared";

const getUrl = createGetUrl("/docs");

// Static export — the whole site ships as plain files to a static host:
//  - `ssr: true` prerenders every listed route to its own HTML file; the build
//    has no runtime server. `/` is left out of the prerender list (below) — it
//    is the static marketing page.
//  - Content files are `.md`, so the prerender glob matches `.md` and `.mdx`.
//  - `/api/search` is prerendered too: the search route returns `staticGET()`,
//    which writes the Orama index as static JSON — no runtime search endpoint.
export default {
	appDirectory: "src",
	ssr: true,
	// `routeDiscovery: "initial"` embeds every route in the initial document, so
	// client-side navigation needs no server. (The default "lazy" mode fetches
	// routes from a dynamic `/__manifest` endpoint, which a static host cannot
	// serve.)
	routeDiscovery: { mode: "initial" },
	async prerender({ getStaticPaths }) {
		const paths: string[] = [];

		// Static routes: `/docs`, `/llms.txt`, `/llms-full.txt`, `/api/search`, `/404`.
		for (const path of getStaticPaths()) {
			// `/` is the static marketing page (public/index.html); it must not be a
			// rendered route. The `*` catch-all reports it as a static path, so skip
			// it here.
			if (path === "/") {
				continue;
			}
			paths.push(path);
		}

		// `/404` powers the static-host not-found fallback (postbuild renames it to
		// build/client/404.html); push it explicitly in case it is not a static path.
		paths.push("/404");

		for await (const entry of glob("**/*.{md,mdx}", { cwd: "content/docs" })) {
			const slugs = getSlugs(entry);

			// Page HTML.
			paths.push(getUrl(slugs));
			// OG image (takumi renders a .webp at build time).
			paths.push(getPageImagePath(slugs));
			// Per-page llms markdown export (llms.mdx/docs/*/content.md).
			paths.push(`${docsContentRoute}/${[...slugs, "content.md"].join("/")}`);
		}

		return Array.from(new Set(paths));
	},
} satisfies Config;
