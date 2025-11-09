import type { PackageBuildConfig } from "../../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/client",
	description: "Client SDK for Aiki",
	directory: "sdk/client",
	dependencies: {
		"@aikirun/lib": "*",
		"@aikirun/types": "*",
		"@orpc/client": "^1.9.3",
		"ioredis": "^5.4.1",
		"zod": "^4.1.12",
	},
	keywords: ["client"],
};

export default config;
