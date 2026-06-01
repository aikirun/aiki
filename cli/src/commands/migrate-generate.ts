import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseProvider } from "@aikirun/types/infra/db";

import { loadDatabaseProvider } from "../lib/db-config";
import { loadEnv } from "../lib/env";
import { resolvePackageRoot, type SupportedPackage } from "../lib/resolve-package";

interface MigrateGenerateOptions {
	pkg: SupportedPackage;
	custom?: boolean;
	envFile?: string;
}

const providerDialects: Record<DatabaseProvider, string> = {
	pg: "postgresql",
	sqlite: "sqlite",
	mysql: "mysql",
};

export async function migrateGenerate(options: MigrateGenerateOptions): Promise<void> {
	loadEnv(options.envFile);
	const dbProvider = loadDatabaseProvider();

	const packageRoot = resolvePackageRoot(options.pkg);
	const schemaDir = path.join("src", "infra", "db", dbProvider);
	const outDir = path.join("src", "infra", "db", dbProvider, "migration");

	ensureWorkspaceMode(path.join(packageRoot, schemaDir));

	const args = [
		"drizzle-kit",
		"generate",
		"--schema",
		schemaDir,
		"--out",
		outDir,
		"--dialect",
		providerDialects[dbProvider],
	];
	if (options.custom) {
		args.push("--custom");
	}

	await spawnDrizzle(args, packageRoot);
}

function ensureWorkspaceMode(schemaDir: string): void {
	if (!fs.existsSync(schemaDir)) {
		throw new Error(
			"aiki migrate generate is only supported inside the Aiki monorepo. Schema generation is a maintainer operation; end users do not need it."
		);
	}
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
