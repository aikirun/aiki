import type { PackageBuildConfig } from "../scripts/build-config.ts";

const config: PackageBuildConfig = {
	name: "@aikirun/lib",
	description: "Foundation utilities library for Aiki SDK",
	directory: "lib",
	entryPoints: [
		"./mod.ts",
		"./array/mod.ts",
		"./async/mod.ts",
		"./crypto/mod.ts",
		"./duration/mod.ts",
		"./error/mod.ts",
		"./json/mod.ts",
		"./object/mod.ts",
		"./polling/mod.ts",
		"./process/mod.ts",
		"./retry/mod.ts",
		"./testing/expect/mod.ts",
	],
	undiciShim: true,
	mappings: {
		"./process/wrapper.deno.ts": "./process/wrapper.node.ts",
	},
	keywords: ["workflows", "retry", "async", "utilities"],
};

export default config;
