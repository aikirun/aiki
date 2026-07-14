import { type RouteConfig, route } from "@react-router/dev/routes";

// `/` is the static marketing page (public/index.html), served at the root; it
// is not a React Router route. React Router owns /docs, the LLM and search
// endpoints, and the not-found page.
export default [
	route("docs/*", "routes/docs.tsx"),
	route("api/search", "routes/search.ts"),
	route("og/docs/*", "routes/og.docs.tsx"),

	route("llms.txt", "llms/index.ts"),
	route("llms-full.txt", "llms/full.ts"),
	route("llms.mdx/docs/*", "llms/mdx.ts"),

	// The static host serves 404.html for any request that matches no file. The
	// prerenderer needs a concrete URL to emit that file, so `/404` is a route
	// that exists to be rendered; postbuild renames its output to 404.html. `*`
	// is the runtime catch-all for bad in-app navigations. Both use the same
	// module, so the literal route takes an explicit id (ids default to the file
	// path).
	route("404", "routes/not-found.tsx", { id: "not-found-404" }),
	route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
