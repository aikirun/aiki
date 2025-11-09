import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/task",
	description: "Task SDK for defining reliable, deterministic tasks",
	directory: "sdk/task",
	dependencies: {
		"@aikirun/lib": "*",
		"@aikirun/types": "*",
		"@aikirun/workflow": "*",
		"@aikirun/client": "*",
	},
	keywords: ["tasks", "retry"],
};

export default config;
