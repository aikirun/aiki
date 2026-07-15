import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Architecture } from "@/components/architecture";
import { LlmText } from "@/components/llm-text";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Architecture,
		LlmText,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
