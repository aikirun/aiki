import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle,
	MarkdownCopyButton,
	ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";

import type { Route } from "./+types/docs";
import { getMDXComponents } from "@/components/mdx";
import { baseOptions } from "@/lib/layout.shared";
import { getPageImagePath } from "@/lib/og";
import { gitConfig, siteUrl } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";

export async function loader({ params }: Route.LoaderArgs) {
	const slugs = params["*"].split("/").filter((v) => v.length > 0);
	const page = source.getPage(slugs);
	if (!page) throw new Response("Not found", { status: 404 });

	return {
		path: page.path,
		markdownUrl: getPageMarkdownUrl(page),
		pageTree: await source.serializePageTree(source.getPageTree()),
		imagePath: getPageImagePath(slugs),
	};
}

const clientLoader = browserCollections.docs.createClientLoader({
	component(
		{ toc, frontmatter, default: Mdx },
		// you can define props for the `<Content />` component
		{
			markdownUrl,
			path,
			imagePath,
		}: {
			markdownUrl: string;
			path: string;
			imagePath: string;
		}
	) {
		return (
			<DocsPage toc={toc}>
				<title>{`${frontmatter.title} — Aiki`}</title>
				<meta name="description" content={frontmatter.description} />
				<meta property="og:type" content="article" />
				<meta property="og:site_name" content="Aiki" />
				<meta property="og:title" content={frontmatter.title} />
				<meta property="og:description" content={frontmatter.description} />
				<meta property="og:image" content={`${siteUrl}${imagePath}`} />
				<meta name="twitter:card" content="summary_large_image" />
				<meta name="twitter:title" content={frontmatter.title} />
				<meta name="twitter:description" content={frontmatter.description} />
				<meta name="twitter:image" content={`${siteUrl}${imagePath}`} />
				<DocsTitle>{frontmatter.title}</DocsTitle>
				<DocsDescription>{frontmatter.description}</DocsDescription>
				<div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
					<MarkdownCopyButton markdownUrl={markdownUrl} />
					<ViewOptionsPopover
						markdownUrl={markdownUrl}
						githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/app/website/content/docs/${path}`}
					/>
				</div>
				<DocsBody>
					<Mdx components={getMDXComponents()} />
				</DocsBody>
			</DocsPage>
		);
	},
});

export default function Page({ loaderData }: Route.ComponentProps) {
	const { path, pageTree, imagePath, markdownUrl } = useFumadocsLoader(loaderData);

	return (
		<DocsLayout {...baseOptions()} tree={pageTree}>
			{clientLoader.useContent(path, { markdownUrl, path, imagePath })}
		</DocsLayout>
	);
}
