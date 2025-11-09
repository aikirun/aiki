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
	dntVersion: "0.40.0",
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
 * Generate dnt mappings to convert workspace imports to npm package imports
 * This ensures dnt treats internal packages as npm dependencies rather than workspace members
 */
export function generateWorkspaceMappings(
	deps: Record<string, string> | undefined,
): Record<string, string> {
	const mappings: Record<string, string> = {};

	if (!deps) return mappings;

	// For each @aikirun/* dependency, map its bare imports to the package itself
	// dnt will use the package.json dependencies we specify to resolve the version
	for (const pkg of Object.keys(deps)) {
		if (pkg.startsWith("@aikirun/")) {
			// Map the base package name so dnt doesn't try to resolve it from workspace
			mappings[pkg] = pkg;
			// Also map subpath imports
			mappings[pkg + "/*"] = pkg;
		}
	}

	return mappings;
}

/**
 * Fix npm package exports to support both bare and file-specific imports
 * Handles two patterns:
 * 1. ./error/mod.js → ./error (nested /mod.js pattern)
 * 2. ./workflow.js → ./workflow (flat file pattern)
 */
export async function fixPackageExports(packageDir: string): Promise<void> {
	const packageJsonPath = `${packageDir}/npm/package.json`;

	try {
		const content = await Deno.readTextFile(packageJsonPath);
		const packageJson = JSON.parse(content);

		if (!packageJson.exports || typeof packageJson.exports !== "object") {
			return;
		}

		const newExports: Record<string, unknown> = {};
		let addedCount = 0;

		// If there's a root export (.), extract the filename to create a matching subpath export
		const rootExport = packageJson.exports["."];
		let mainFileName: string | null = null;
		if (rootExport && typeof rootExport === "object") {
			const importValue = (rootExport as Record<string, unknown>)["import"];
			if (typeof importValue === "string") {
				// Extract filename from path like "./esm/client.js"
				const match = importValue.match(/\/([^/]+)\.js$/);
				if (match && match[1]) {
					mainFileName = match[1]; // e.g., "client"
				}
			}
		}

		// Process each export entry
		for (const [key, value] of Object.entries(packageJson.exports)) {
			// Add the original entry
			newExports[key] = value;

			// Pattern 1: Handle /mod.js pattern: "./error/mod.js" → "./error"
			if (key.endsWith("/mod.js")) {
				const basePath = key.slice(0, -"/mod.js".length);
				if (!(basePath in newExports)) {
					newExports[basePath] = value;
					addedCount++;
				}
			} // Pattern 2: Handle bare .js pattern: "./workflow.js" → "./workflow"
			// Only for top-level files (no "/" after the initial "./")
			else if (key.endsWith(".js") && !key.includes("/", 2)) {
				const basePath = key.slice(0, -".js".length);
				// Avoid creating duplicate root exports
				if (basePath !== "." && !(basePath in newExports)) {
					newExports[basePath] = value;
					addedCount++;
				}
			}
		}

		// Add export for main entry point if it's not already there
		// e.g., if root export points to client.js, also export ./client
		const mainKey = `./${mainFileName}`;
		if (mainFileName && !(mainKey in newExports)) {
			const mainExportValue = newExports["."];
			newExports[mainKey] = mainExportValue;
			addedCount++;
		}

		packageJson.exports = newExports;
		await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, "\t"));
		console.log(`✓ Fixed package exports: added ${addedCount} bare import paths`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.warn(`Warning: Could not fix package exports: ${errorMessage}`);
	}
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
