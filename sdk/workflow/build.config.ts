import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aiki/workflow",
	description: "Workflow SDK for defining durable workflows",
	directory: "sdk/workflow",
	dependencies: {
		"@aiki/lib": "*",
		"@aiki/types": "*",
	},
	keywords: ["workflows"],
};

export default config;
