import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Architecture } from "@/components/architecture";
import { LlmText } from "@/components/llm-text";

export function getMDXComponents(components?: MDXComponents) {
	return {
		...defaultMdxComponents,
		Accordion,
		Accordions,
		Tab,
		Tabs,
		Architecture,
		LlmText,
		...components,
	} satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
	type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
