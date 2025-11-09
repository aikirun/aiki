import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aiki/task",
	description: "Task SDK for defining reliable, deterministic tasks",
	directory: "sdk/task",
	dependencies: {
		"@aiki/lib": "*",
		"@aiki/types": "*",
		"@aiki/workflow": "*",
	},
	keywords: ["tasks", "retry"],
};

export default config;
