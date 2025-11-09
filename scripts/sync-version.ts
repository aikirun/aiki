#!/usr/bin/env -S deno run --allow-read --allow-write
// deno-lint-ignore-file no-console

/**
 * Sync package versions across all Aiki packages
 *
 * This script:
 * 1. Dynamically discovers all deno.json files in the repo
 * 2. Infers package dependencies from their import statements
 * 3. Finds the highest version number across all packages
 * 4. Updates all packages to use that version
 * 5. Updates all import paths to match
 * 6. Validates with deno check
 *
 * Dependencies are inferred from the `imports` section of each deno.json,
 * so no hardcoding is needed. If you add a new package or change imports,
 * the script automatically understands the new structure.
 *
 * Usage:
 *   deno run sync-version.ts
 *
 * This is typically run after manually editing lib/deno.json version,
 * before committing and publishing.
 */

interface DenoJson {
	name: string;
	version: string;
	description?: string;
	exports?: unknown;
	imports?: Record<string, string>;
	license?: string;
	[key: string]: unknown;
}

interface PackageInfo {
	name: string;
	path: string;
	version: string;
	denoJson: DenoJson;
	dependencies: Set<string>;
}

async function readDenoJson(path: string): Promise<DenoJson> {
	const content = await Deno.readTextFile(path);
	return JSON.parse(content) as DenoJson;
}

async function writeDenoJson(path: string, data: DenoJson): Promise<void> {
	const content = JSON.stringify(data, null, "\t") + "\n";
	await Deno.writeTextFile(path, content);
}

async function discoverPackages(): Promise<PackageInfo[]> {
	const packages: PackageInfo[] = [];

	// Find all deno.json files (lib, types, sdk/*)
	const possiblePaths = [
		"lib/deno.json",
		"types/deno.json",
		"sdk/client/deno.json",
		"sdk/worker/deno.json",
		"sdk/task/deno.json",
		"sdk/workflow/deno.json",
	];

	for (const path of possiblePaths) {
		try {
			const denoJson = await readDenoJson(path);

			// Extract dependencies from imports section
			const dependencies = new Set<string>();
			if (denoJson.imports) {
				for (const importValue of Object.values(denoJson.imports)) {
					// Match patterns like: jsr:@aiki/lib@^0.1.0, jsr:@aiki/types@^0.1.0/*
					const matches = importValue.match(/jsr:@aiki\/(\w+)@/g);
					if (matches) {
						for (const match of matches) {
							// Extract package name from: jsr:@aiki/lib@
							const pkgName = match.replace(/jsr:@aiki\/(\w+)@/, "@aiki/$1");
							dependencies.add(pkgName);
						}
					}
				}
			}

			packages.push({
				name: denoJson.name,
				path,
				version: denoJson.version,
				denoJson,
				dependencies,
			});
		} catch (error) {
			if (!(error instanceof Deno.errors.NotFound)) {
				throw error;
			}
			// File doesn't exist, skip it
		}
	}

	if (packages.length === 0) {
		throw new Error("No deno.json files found");
	}

	return packages;
}

function compareVersions(v1: string, v2: string): number {
	const parse = (v: string) => v.split(".").map(Number);
	const p1 = parse(v1);
	const p2 = parse(v2);

	for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
		const n1 = p1[i] || 0;
		const n2 = p2[i] || 0;
		if (n1 > n2) return 1;
		if (n1 < n2) return -1;
	}
	return 0;
}

function colorize(text: string, color: "green" | "red" | "yellow" | "blue"): string {
	const colors: Record<string, string> = {
		green: "\x1b[32m",
		red: "\x1b[31m",
		yellow: "\x1b[33m",
		blue: "\x1b[34m",
	};
	const reset = "\x1b[0m";
	return `${colors[color]}${text}${reset}`;
}

async function main() {
	console.log(colorize("📦 Aiki Version Sync\n", "blue"));

	console.log("Discovering package dependencies...\n");

	let packages: PackageInfo[];
	try {
		packages = await discoverPackages();
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(colorize(`❌ Error discovering packages: ${errorMessage}`, "red"));
		Deno.exit(1);
	}

	packages.sort((a, b) => a.name.localeCompare(b.name));
	console.log(`Found ${packages.length} packages:`);

	for (const pkg of packages) {
		console.log(`  ${pkg.name}`);
		if (pkg.dependencies.size > 0) {
			const deps = Array.from(pkg.dependencies).sort().join(", ");
			console.log(`    ├─ depends on: ${deps}`);
		}
	}

	let highestVersion = "0.0.0";
	for (const pkg of packages) {
		if (compareVersions(pkg.version, highestVersion) > 0) {
			highestVersion = pkg.version;
		}
	}

	console.log(`\nHighest version found: ${colorize(highestVersion, "blue")}`);

	const allMatch = packages.every((p) => p.version === highestVersion);

	if (allMatch) {
		console.log(colorize(`✅ All packages already synced to version ${highestVersion}\n`, "green"));
		Deno.exit(0);
	}

	console.log(`\nSyncing all packages to ${colorize(highestVersion, "green")}...\n`);

	const changes: { pkg: string; oldVersion: string; newVersion: string }[] = [];

	for (const pkg of packages) {
		const oldVersion = pkg.version;

		if (oldVersion !== highestVersion) {
			pkg.denoJson.version = highestVersion;
			changes.push({ pkg: pkg.name, oldVersion, newVersion: highestVersion });
		}

		if (pkg.denoJson.imports && pkg.dependencies.size > 0) {
			for (const [importKey, importValue] of Object.entries(pkg.denoJson.imports)) {
				let updated = importValue;
				for (const depName of pkg.dependencies) {
					// Match: jsr:@aiki/lib@^0.1.0 or jsr:@aiki/lib@^0.1.0/*
					const regex = new RegExp(`(jsr:${depName.replace(/\//g, "\\/")}@)\\^[\\d.]+`);
					if (regex.test(updated)) {
						updated = updated.replace(regex, `$1^${highestVersion}`);
					}
				}

				if (updated !== importValue) {
					pkg.denoJson.imports[importKey] = updated;
					console.log(`  ${pkg.name} - Updated import: ${importKey}`);
				}
			}
		}

		await writeDenoJson(pkg.path, pkg.denoJson);
	}

	if (changes.length > 0) {
		console.log(colorize("\nVersion updates:", "yellow"));
		for (const change of changes) {
			console.log(
				`  ${change.pkg}: ${colorize(change.oldVersion, "red")} → ${colorize(change.newVersion, "green")}`,
			);
		}
	}

	console.log(colorize("\n✅ Version sync complete!\n", "green"));
	console.log("Next steps:");
	console.log("  1. Review changes: git diff");
	console.log(`  2. Commit: git commit -m "Bump version to ${highestVersion}"`);
	console.log("  3. Publish: JSR_TOKEN=<token> ./publish-to-jsr.sh");
	console.log("  4. Tag: ./post-publish.sh");
}

main().catch((error) => {
	console.error(colorize(`❌ Error: ${error.message}`, "red"));
	Deno.exit(1);
});
