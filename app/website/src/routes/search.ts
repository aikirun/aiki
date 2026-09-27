import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

const server = createFromSource(source, {
	// https://docs.orama.com/docs/orama-js/supported-languages
	language: "english",
});

// Static search: `staticGET()` exports the prebuilt Orama index as JSON.
// This route is in the prerender list (react-router.config.ts), so the index
// is written to `build/client/api/search` at build time. The client uses the
// `type: 'static'` search dialog to download and query it entirely in-browser,
// with no server search endpoint at runtime.
export async function loader() {
	return server.staticGET();
}
