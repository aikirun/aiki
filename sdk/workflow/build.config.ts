import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/workflow",
	description: "Workflow SDK for defining durable workflows",
	directory: "sdk/workflow",
	dependencies: {
		"@aikirun/lib": "*",
		"@aikirun/types": "*",
	},
	keywords: ["workflows"],
};

export default config;
