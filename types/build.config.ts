import type { PackageBuildConfig } from "../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/types",
	description: "Core TypeScript type definitions for Aiki SDK",
	directory: "types",
	entryPoints: [
		"./client.ts",
		"./trigger.ts",
		"./workflow.ts",
		"./workflow-run.ts",
		"./workflow-run-api.ts",
		"./task.ts",
	],
	dependencies: {
		"@aikirun/lib": "*",
	},
	keywords: ["types", "workflows"],
};

export default config;
