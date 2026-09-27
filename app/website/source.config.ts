import { defineConfig, defineDocs } from "fumadocs-mdx/config";

import { remarkDocsLinks } from "./lib/remark-docs-links";

export const docs = defineDocs({
	dir: "content/docs",
	docs: {
		postprocess: {
			includeProcessedMarkdown: true,
		},
	},
});

export default defineConfig({
	mdxOptions: {
		remarkPlugins: (plugins) => [...plugins, remarkDocsLinks],
	},
});
