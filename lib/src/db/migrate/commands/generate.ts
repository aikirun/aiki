import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DATABASE_PROVIDERS, type DatabaseProvider } from "../../provider";

const providerDialects: Record<DatabaseProvider, string> = {
	pg: "postgresql",
	// sqlite: "sqlite",
	// mysql: "mysql",
};

interface MigrateGenerateParams {
	// Spawn directory — drizzle-kit is resolved from here
	packageRoot: string;
	resolveSchemaFile: (provider: DatabaseProvider) => string;
	resolveMigrationsDir: (provider: DatabaseProvider) => string;
	custom?: boolean;
}

export async function migrateGenerate(params: MigrateGenerateParams): Promise<void> {
	for (const provider of DATABASE_PROVIDERS) {
		const schemaFile = params.resolveSchemaFile(provider);
		if (!fs.existsSync(schemaFile)) {
			throw new Error(`no schema file for ${provider} database at ${schemaFile}`);
		}

		console.log(`generating ${provider} migrations`);

		const args = [
			"drizzle-kit",
			"generate",
			"--schema",
			path.relative(params.packageRoot, schemaFile),
			"--out",
			path.relative(params.packageRoot, params.resolveMigrationsDir(provider)),
			"--dialect",
			providerDialects[provider],
		];
		if (params.custom) {
			args.push("--custom");
		}

		await spawnDrizzle(args, params.packageRoot);
	}
}

function spawnDrizzle(args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const childProc = spawn("bunx", args, { stdio: "inherit", cwd });
		childProc.on("exit", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`drizzle-kit exited with code ${code}`));
			}
		});
		childProc.on("error", reject);
	});
}
