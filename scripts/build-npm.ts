#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
// deno-lint-ignore-file no-console

import { build, emptyDir } from "https://deno.land/x/dnt@0.40.0/mod.ts";
import { join, dirname } from "https://deno.land/std@0.224.0/path/mod.ts";
import type { PackageBuildConfig } from "./build-config.ts";
import { COMMON_CONFIG, resolveDependencies, defaultPostBuild } from "./build-config.ts";

/**
 * Build a single package for npm using dnt
 *
 * @param packageDir - Absolute path to package directory
 * @param config - Package build configuration
 */
async function buildPackage(packageDir: string, config: PackageBuildConfig): Promise<void> {
	const version = Deno.env.get("PKG_VERSION") || "0.1.0";

	// Normalize entry points
	const entryPoints = Array.isArray(config.entryPoints)
		? config.entryPoints
		: config.entryPoints
			? [config.entryPoints]
			: ["./mod.ts"];

	// Merge keywords
	const keywords = [
		...COMMON_CONFIG.commonKeywords,
		...(config.keywords || []),
	];

	// Resolve dependencies
	const dependencies = resolveDependencies(config.dependencies, version);

	// Build npm directory path
	const npmDir = join(packageDir, "npm");

	console.log(`Building ${config.name} v${version}...`);

	// Empty npm directory
	await emptyDir(npmDir);

	// Build with dnt
	await build({
		entryPoints,
		outDir: npmDir,
		shims: {
			deno: true,
			...(config.undiciShim ? { undici: true } : {}),
		},
		...(config.mappings ? { mappings: config.mappings } : {}),
		package: {
			name: config.name,
			version,
			description: config.description,
			license: COMMON_CONFIG.license,
			repository: {
				...COMMON_CONFIG.repository,
				directory: config.directory,
			},
			homepage: COMMON_CONFIG.homepage,
			keywords,
			engines: COMMON_CONFIG.engines,
			...(dependencies ? { dependencies } : {}),
		},
		async postBuild() {
			// Use custom postBuild or default
			if (config.postBuild) {
				await config.postBuild();
			} else {
				await defaultPostBuild(packageDir);
			}
		},
	});

	console.log(`✅ ${config.name} built successfully\n`);
}

/**
 * Load and build a package from its build.config.ts
 */
async function buildFromConfigFile(configPath: string): Promise<void> {
	const packageDir = dirname(configPath);

	// Dynamically import the config
	const module = await import(`file://${configPath}`);
	const config: PackageBuildConfig = module.default;

	await buildPackage(packageDir, config);
}

/**
 * Main entry point
 * Usage:
 *   deno run -A scripts/build-npm.ts lib/build.config.ts
 *   deno run -A scripts/build-npm.ts sdk/workflow/build.config.ts
 */
if (import.meta.main) {
	const configPath = Deno.args[0];

	if (!configPath) {
		console.error("❌ Error: No config file specified");
		console.error("\nUsage: deno run -A scripts/build-npm.ts <path-to-build.config.ts>");
		console.error("\nExamples:");
		console.error("  deno run -A scripts/build-npm.ts lib/build.config.ts");
		console.error("  deno run -A scripts/build-npm.ts sdk/workflow/build.config.ts");
		Deno.exit(1);
	}

	// Resolve to absolute path
	const absoluteConfigPath = join(Deno.cwd(), configPath);

	try {
		await buildFromConfigFile(absoluteConfigPath);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Build failed: ${errorMessage}`);
		Deno.exit(1);
	}
}
