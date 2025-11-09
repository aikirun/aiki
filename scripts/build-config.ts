// deno-lint-ignore-file no-console

/**
 * Package build configuration for dnt builds
 */
export interface PackageBuildConfig {
	/** Package name (e.g., "@aikirun/lib") */
	name: string;

	/** Package description */
	description: string;

	/** Repository directory (e.g., "lib", "sdk/workflow") */
	directory: string;

	/**
	 * Entry points for the package
	 * Can be a single string "./mod.ts" or array of strings
	 * Defaults to ["./mod.ts"] if not specified
	 */
	entryPoints?: string | string[];

	/**
	 * NPM dependencies
	 * Use special syntax "@aikirun/*": "*" to auto-resolve to current version
	 */
	dependencies?: Record<string, string>;

	/** Package-specific keywords (will be merged with common keywords) */
	keywords?: string[];

	/**
	 * Enable undici shim (for HTTP fetch in Node.js)
	 * Defaults to false
	 */
	undiciShim?: boolean;

	/**
	 * File mappings for platform-specific implementations
	 * Maps Deno files to Node.js alternatives
	 */
	mappings?: Record<string, string>;

	/**
	 * Custom postBuild hook
	 * Defaults to copying and transforming README.md for npm
	 */
	postBuild?: () => Promise<void>;

	/**
	 * Transform README for npm distribution
	 * Converts JSR/Deno-specific instructions to npm-specific ones
	 * Defaults to true
	 */
	transformReadmeForNpm?: boolean;
}

/**
 * Common configuration shared across all packages
 */
export const COMMON_CONFIG = {
	license: "Apache-2.0",
	repository: {
		type: "git" as const,
		url: "https://github.com/aikirun/aiki.git",
	},
	homepage: "https://github.com/aikirun/aiki",
	engines: {
		node: ">=18.0.0",
	},
	commonKeywords: [
		"durable-execution",
		"typescript",
	],
	dntVersion: "0.41.1",
} as const;

/**
 * Resolve @aikirun/* dependencies to current package version
 */
export function resolveDependencies(
	deps: Record<string, string> | undefined,
	version: string,
): Record<string, string> | undefined {
	if (!deps) return undefined;

	const resolved: Record<string, string> = {};
	for (const [pkg, ver] of Object.entries(deps)) {
		// Auto-resolve @aikirun/* packages to current version
		if (pkg.startsWith("@aikirun/") && ver === "*") {
			resolved[pkg] = version;
		} else {
			resolved[pkg] = ver;
		}
	}
	return resolved;
}

/**
 * Default postBuild: copy and transform README.md for npm distribution
 */
export async function defaultPostBuild(
	packageDir: string,
	config?: { transformReadme?: boolean; packageName?: string },
): Promise<void> {
	const readmePath = `${packageDir}/README.md`;
	const npmReadmePath = `${packageDir}/npm/README.md`;
	const shouldTransform = config?.transformReadme !== false;

	try {
		let content = await Deno.readTextFile(readmePath);

		// Transform README for npm if enabled
		if (shouldTransform) {
			const { transformReadmeForNpm } = await import("./transform-readme.ts");
			const packageName = config?.packageName || "@aikirun/lib";
			content = transformReadmeForNpm(content, packageName);
		}

		await Deno.writeTextFile(npmReadmePath, content);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.warn(`Warning: Could not process README.md: ${errorMessage}`);
	}
}
