import { ImageResponse } from "takumi-js/response";

import { OgCard } from "@/components/og-card";

/**
 * The card for `/`, which is the static marketing page and so cannot pick up meta from a route.
 * `public/index.html` points its `og:image` at the path this route prerenders to.
 */
export function loader() {
	return new ImageResponse(
		<OgCard
			title="Durable workflows in TypeScript"
			description="An async function that survives crashes, restarts and deploys, then picks up where it left off."
		/>,
		{
			width: 1200,
			height: 630,
			format: "webp",
		}
	);
}
