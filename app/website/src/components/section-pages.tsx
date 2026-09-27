import { Link } from "react-router";

export interface SectionPage {
	title: string;
	description?: string;
	url: string;
}

export type SectionIndex = Record<string, SectionPage[]>;

/**
 * The pages of one docs folder, titles and descriptions read from the pages themselves so the
 * index cannot drift from what it links to. Ordering follows the folder's `meta.json`.
 */
export function SectionPages({ section, index }: { section: string; index?: SectionIndex }) {
	const pages = index?.[section];
	if (!pages || pages.length === 0) {
		return null;
	}

	// The list is pulled out by the row padding, so the hover band clears the text while the text
	// itself stays on the prose margin.
	return (
		<div className="not-prose -mx-3 my-6 flex flex-col divide-y divide-fd-border border-y border-fd-border">
			{pages.map((page) => (
				<Link
					key={page.url}
					to={page.url}
					className="group flex flex-col gap-1 px-3 py-4 no-underline transition-colors hover:bg-fd-accent"
				>
					<span className="font-medium text-fd-foreground group-hover:text-fd-accent-foreground">{page.title}</span>
					{page.description && <span className="text-sm text-fd-muted-foreground">{page.description}</span>}
				</Link>
			))}
		</div>
	);
}
