import path from "node:path";

/**
 * Docs are authored with GitHub-native links: relative paths to the actual
 * `.md`/`.mdx` files, and relative paths into `public/` for assets. GitHub's
 * file browser resolves those directly. This remark plugin runs at build time
 * and rewrites them into the website's URLs:
 *   - relative `./installation.md` / `../core-concepts/workflows.md`  → `/docs/...` routes
 *   - relative `../../public/assets/logo.svg`                         → `/assets/logo.svg`
 * Absolute (`/docs/...`, `http…`) and anchor-only (`#…`) links are left alone.
 */

const DOCS_MARKER = `${path.sep}content${path.sep}docs${path.sep}`;

interface MdNode {
	type?: string;
	url?: string;
	name?: string;
	attributes?: Array<{ type?: string; name?: string; value?: unknown }>;
	children?: MdNode[];
}

interface RemarkFile {
	path?: string;
	cwd?: string;
	history?: string[];
}

function isExternalOrAbsolute(url: string): boolean {
	return /^[a-z]+:/i.test(url) || url.startsWith("//") || url.startsWith("/") || url.startsWith("#");
}

export function remarkDocsLinks() {
	return (tree: MdNode, file: RemarkFile): void => {
		const rawPath = file.path ?? file.history?.[file.history.length - 1];
		if (!rawPath) {
			return;
		}
		const filePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(file.cwd ?? process.cwd(), rawPath);
		const markerIndex = filePath.indexOf(DOCS_MARKER);
		if (markerIndex === -1) {
			return;
		}
		const websiteRoot = filePath.slice(0, markerIndex);
		const docsRoot = path.join(websiteRoot, "content", "docs");
		const publicDir = path.join(websiteRoot, "public");
		const fileDir = path.dirname(filePath);

		const toRoute = (url: string): string | null => {
			if (isExternalOrAbsolute(url)) {
				return null;
			}
			const hashIndex = url.indexOf("#");
			const anchor = hashIndex === -1 ? "" : url.slice(hashIndex);
			const target = hashIndex === -1 ? url : url.slice(0, hashIndex);
			if (!/\.(md|mdx)$/i.test(target)) {
				return null;
			}
			const absolute = path.resolve(fileDir, target);
			let relative = path.relative(docsRoot, absolute).split(path.sep).join("/");
			relative = relative.replace(/\.(md|mdx)$/i, "").replace(/(^|\/)index$/i, "");
			const route = relative ? `/docs/${relative}` : "/docs";
			return route + anchor;
		};

		const toAssetPath = (url: string): string | null => {
			if (isExternalOrAbsolute(url)) {
				return null;
			}
			const absolute = path.resolve(fileDir, url);
			if (!absolute.startsWith(publicDir + path.sep)) {
				return null;
			}
			return `/${path.relative(publicDir, absolute).split(path.sep).join("/")}`;
		};

		const walk = (node: MdNode): void => {
			if (node.type === "link" && typeof node.url === "string") {
				const route = toRoute(node.url);
				if (route) {
					node.url = route;
				}
			} else if (node.type === "image" && typeof node.url === "string") {
				const asset = toAssetPath(node.url);
				if (asset) {
					node.url = asset;
				}
			} else if ((node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === "img") {
				for (const attribute of node.attributes ?? []) {
					if (attribute.type === "mdxJsxAttribute" && attribute.name === "src" && typeof attribute.value === "string") {
						const asset = toAssetPath(attribute.value);
						if (asset) {
							attribute.value = asset;
						}
					}
				}
			}
			for (const child of node.children ?? []) {
				walk(child);
			}
		};
		walk(tree);
	};
}

export default remarkDocsLinks;
