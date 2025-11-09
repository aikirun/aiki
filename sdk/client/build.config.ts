import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aiki/client",
	description: "Client SDK for Aiki",
	directory: "sdk/client",
	dependencies: {
		"@aiki/lib": "*",
		"@aiki/types": "*",
	},
	keywords: ["client"],
};

export default config;
