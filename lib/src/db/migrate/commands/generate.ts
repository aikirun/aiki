import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { DATABASE_PROVIDERS, type DatabaseProvider } from "../../provider";

const providerDialects: Record<DatabaseProvider, string> = {
	pg: "postgresql",
	sqlite: "sqlite",
	mysql: "mysql",
};

interface MigrateGenerateParams {
	// Spawn directory — drizzle-kit is resolved from here
	packageRoot: string;
	resolveSchemaDir: (provider: DatabaseProvider) => string;
	resolveMigrationsDir: (provider: DatabaseProvider) => string;
	custom?: boolean;
}

export async function migrateGenerate(params: MigrateGenerateParams): Promise<void> {
	let generated = 0;

	for (const provider of DATABASE_PROVIDERS) {
		const schemaDir = params.resolveSchemaDir(provider);
		if (!fs.existsSync(schemaDir)) {
			continue;
		}

		console.log(`generating ${provider} migrations`);

		const args = [
			"drizzle-kit",
			"generate",
			"--schema",
			path.relative(params.packageRoot, schemaDir),
			"--out",
			path.relative(params.packageRoot, params.resolveMigrationsDir(provider)),
			"--dialect",
			providerDialects[provider],
		];
		if (params.custom) {
			args.push("--custom");
		}

		await spawnDrizzle(args, params.packageRoot);
		generated += 1;
	}

	if (generated === 0) {
		throw new Error("no schema sources found for any database provider");
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
