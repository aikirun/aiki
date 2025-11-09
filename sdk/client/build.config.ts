import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/client",
	description: "Client SDK for Aiki",
	directory: "sdk/client",
	dependencies: {
		"@aikirun/lib": "*",
		"@aikirun/types": "*",
	},
	keywords: ["client"],
};

export default config;
