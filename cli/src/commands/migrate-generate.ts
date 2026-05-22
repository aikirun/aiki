import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type DatabaseProvider, loadDatabaseConfig } from "@aikirun/server/config";

import { loadEnv } from "../lib/env";
import { resolveServerRoot } from "../lib/resolve-server";

interface MigrateGenerateOptions {
	custom?: boolean;
	envFile?: string;
}

export async function migrateGenerate(options: MigrateGenerateOptions): Promise<void> {
	loadEnv(options.envFile);
	const dbConfig = loadDatabaseConfig();

	const serverRoot = resolveServerRoot();
	ensureWorkspaceMode(serverRoot, dbConfig.provider);

	const configPath = resolveDrizzleConfigPath();
	const args = ["drizzle-kit", "generate", "--config", configPath];
	if (options.custom) {
		args.push("--custom");
	}

	await spawnDrizzle(args, serverRoot);
}

function ensureWorkspaceMode(serverRoot: string, provider: DatabaseProvider): void {
	const schemaDir = path.join(serverRoot, "src", "infra", "db", provider, "schema");
	if (!fs.existsSync(schemaDir)) {
		throw new Error(
			"aiki migrate generate is only supported inside the Aiki monorepo. Schema generation is a maintainer operation; end users do not need it."
		);
	}
}

function resolveDrizzleConfigPath(): string {
	// Source mode runs from cli/src/commands/, compiled mode runs from cli/dist/.
	// Walk up until we hit the first package.json — in both layouts that's the cli package root.
	let dir = path.dirname(fileURLToPath(import.meta.url));
	while (dir !== path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "package.json"))) {
			return path.join(dir, "drizzle.config.ts");
		}
		dir = path.dirname(dir);
	}
	throw new Error("Could not locate @aikirun/cli root for drizzle.config.ts");
}

function spawnDrizzle(args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("bunx", args, { stdio: "inherit", cwd });
		proc.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`drizzle-kit exited with code ${code}`));
			}
		});
		proc.on("error", reject);
	});
}
