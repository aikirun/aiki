import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { defineConfig, type Plugin } from "vite";

// In dev, React Router's middleware SSRs `/` (the `*` catch-all) before the
// static layer, so public/index.html is never reached. This serves it there; in
// the build, Vite copies public/ into build/client and no plugin is needed.
function serveMarketingRoot(): Plugin {
	const marketingPath = fileURLToPath(new URL("./public/index.html", import.meta.url));
	return {
		name: "aiki-serve-marketing-root",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = req.url?.split("?")[0];
				if (path === "/" || path === "/index.html") {
					res.setHeader("Content-Type", "text/html");
					res.end(readFileSync(marketingPath, "utf8"));
					return;
				}
				next();
			});
		},
	};
}

export default defineConfig({
	plugins: [serveMarketingRoot(), mdx(), tailwindcss(), reactRouter()],
	server: {
		port: 9852,
	},
	optimizeDeps: {
		// Transitive deps of fumadocs-ui that Vite's scanner cannot see up front
		// (they sit behind dynamic imports, in bun's isolated store). Without
		// these, Vite discovers them mid-session and re-bundles: in-flight module
		// URLs 504 ("Outdated Optimize Dep"), the page never hydrates, and the
		// CJS use-sync-external-store fails named-import interop.
		include: [
			"fumadocs-ui > cnfast",
			"fumadocs-ui > lucide-react",
			"fumadocs-ui > @base-ui/react > use-sync-external-store/shim",
			"fumadocs-ui > @base-ui/react > use-sync-external-store/shim/with-selector",
		],
	},
	resolve: {
		tsconfigPaths: true,
	},
});
