import { ImageResponse } from "takumi-js/response";

import type { Route } from "./+types/og.docs";
import { OgCard } from "@/components/og-card";
import { source } from "@/lib/source";

/**
 * The docs root is titled "Introduction", which names nothing once the link leaves the site. Its
 * card says what the page is instead; the homepage carries the product line, since that is the link
 * that travels furthest.
 */
const ROOT_CARD_TITLE = "Aiki Documentation";

/** Folder slugs title-case to exactly the titles in each `meta.json`, so no lookup is needed. */
function sectionLabel(slugs: string[]): string | undefined {
	const folder = slugs.length > 1 ? slugs[0] : undefined;
	return folder
		?.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

export function loader({ params }: Route.LoaderArgs) {
	const slugs = params["*"]
		.split("/")
		.filter((v) => v.length > 0)
		.slice(0, -1);
	const page = source.getPage(slugs);

	if (!page) throw new Response(undefined, { status: 404 });

	const isRoot = slugs.length === 0;

	return new ImageResponse(
		<OgCard
			title={isRoot ? ROOT_CARD_TITLE : page.data.title}
			description={page.data.description}
			eyebrow={sectionLabel(slugs)}
		/>,
		{
			width: 1200,
			height: 630,
			format: "webp",
		}
	);
}
