import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/worker",
	description: "Worker SDK for executing workflows and tasks",
	directory: "sdk/worker",
	dependencies: {
		"@aikirun/lib": "*",
		"@aikirun/types": "*",
		"@aikirun/client": "*",
		"@aikirun/workflow": "*",
	},
	keywords: ["worker", "scaling"],
};

export default config;
