import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadDatabaseConfig } from "@aikirun/server/config";

import { loadEnv } from "../lib/env";
import { resolveServerRoot } from "../lib/resolve-server";

interface MigrateGenerateOptions {
	custom?: boolean;
	envFile?: string;
}

export async function migrateGenerate(options: MigrateGenerateOptions): Promise<void> {
	loadEnv(options.envFile);
	loadDatabaseConfig();

	const serverRoot = resolveServerRoot();
	const configPath = resolveDrizzleConfigPath(serverRoot);
	const args = ["drizzle-kit", "generate", "--config", configPath];
	if (options.custom) {
		args.push("--custom");
	}

	await spawnDrizzle(args, serverRoot);
}

function resolveDrizzleConfigPath(serverRoot: string): string {
	const configPath = path.join(serverRoot, "infra", "db", "drizzle.config.ts");
	if (!fs.existsSync(configPath)) {
		throw new Error(
			"aiki migrate generate is only supported inside the Aiki monorepo. Schema generation is a maintainer operation; end users do not need it."
		);
	}
	return configPath;
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
