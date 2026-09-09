import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

import { docsContentRoute, docsRoute } from "./shared";
import type { SectionIndex, SectionPage } from "@/components/section-pages";

export const source = loader({
	source: docs.toFumadocsSource(),
	baseUrl: docsRoute,
});

export function getPageMarkdownUrl(page: (typeof source)["$inferPage"]) {
	return `${docsContentRoute}/${[...page.slugs, "content.md"].join("/")}`;
}

export async function getLLMText(page: (typeof source)["$inferPage"]) {
	const processed = await page.data.getText("processed");

	return `# ${page.data.title} (${page.url})

${processed}`;
}

/**
 * Titles and descriptions for the pages of every docs folder, keyed by folder slug, for the docs
 * index to render instead of hand-maintaining its own copy of them.
 *
 * The page tree supplies the ordering, because that is where each folder's `meta.json` reading
 * order lands; the descriptions come from the pages, because tree nodes do not reliably carry one.
 */
export function buildSectionIndex(): SectionIndex {
	const byUrl = new Map(source.getPages().map((page) => [page.url, page]));
	const index: SectionIndex = {};

	for (const node of source.getPageTree().children) {
		if (node.type !== "folder") {
			continue;
		}
		const pages: SectionPage[] = [];
		for (const child of node.children) {
			if (child.type !== "page") {
				continue;
			}
			const page = byUrl.get(child.url);
			if (!page) {
				continue;
			}
			pages.push({ title: page.data.title, description: page.data.description, url: page.url });
		}
		const folder = pages[0] && byUrl.get(pages[0].url)?.slugs[0];
		if (folder && pages.length > 0) {
			index[folder] = pages;
		}
	}

	return index;
}
