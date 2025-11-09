import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aiki/worker",
	description: "Worker SDK for executing workflows and tasks",
	directory: "sdk/worker",
	dependencies: {
		"@aiki/lib": "*",
		"@aiki/types": "*",
		"@aiki/client": "*",
		"@aiki/workflow": "*",
	},
	keywords: ["worker", "scaling"],
};

export default config;
