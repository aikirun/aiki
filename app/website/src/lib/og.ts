import { docsImageRoute } from "./shared";

export function getPageImagePath(slugs: string[]) {
	const segments = [...slugs, "image.webp"];

	return `${docsImageRoute}/${segments.join("/")}`;
}
