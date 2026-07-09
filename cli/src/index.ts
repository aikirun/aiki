// biome-ignore-all lint/suspicious/noConsole: this prints command output, not logs
import process from "node:process";
import { startAppServer } from "@aikirun/app-server";
import { loadDatabaseConfig, loadDatabaseProvider } from "@aikirun/lib/db";
import { migrateApply, migrateList, migrationSource } from "@aikirun/lib/db/migrate";
import { cac } from "cac";
import { config as loadEnv } from "dotenv";

import { embeddedDataLoader } from "./embedded";
import packageJson from "../package.json" with { type: "json" };

const MIGRATE_SUBCOMMANDS = ["apply", "list"] as const;
type MigrateSubcommand = (typeof MIGRATE_SUBCOMMANDS)[number];

function isMigrateSubcommand(value: string): value is MigrateSubcommand {
	for (const command of MIGRATE_SUBCOMMANDS) {
		if (command === value) {
			return true;
		}
	}
	return false;
}

export const MIGRATION_PACKAGES = ["server", "iam"] as const;
export type MigrationPackage = (typeof MIGRATION_PACKAGES)[number];

export function isMigrationPackage(value: string): value is MigrationPackage {
	for (const pkg of MIGRATION_PACKAGES) {
		if (pkg === value) {
			return true;
		}
	}
	return false;
}

const cli = cac("aiki");

cli
	.command("migrate [subcommand]", "Database migration commands (apply | list)")
	.option("--package <name>", `Target package: ${MIGRATION_PACKAGES.join(" | ")} (default: server)`)
	.option("--env-file <path>", "Path to env file")
	.example((name) => `  $ ${name} migrate apply                 apply the server's pending migrations`)
	.example((name) => `  $ ${name} migrate apply --package iam   apply the iam package's migrations`)
	.example((name) => `  $ ${name} migrate list                  list the migrations the binary ships`)
	.action(async (subcommand: string | undefined, options: { package?: string; envFile?: string }) => {
		if (subcommand === undefined) {
			cli.outputHelp();
			return;
		}
		if (!isMigrateSubcommand(subcommand)) {
			throw new Error(
				`Unknown migrate subcommand "${subcommand}". Expected one of: ${MIGRATE_SUBCOMMANDS.join(", ")}.`
			);
		}

		const pkg = options.package ?? "server";
		if (!isMigrationPackage(pkg)) {
			throw new Error(`Unknown package "${pkg}". Expected one of: ${MIGRATION_PACKAGES.join(", ")}.`);
		}
		if (options.envFile) {
			loadEnv({ path: options.envFile });
		}

		const embeddedData = (await embeddedDataLoader.load()).data;
		const packageData = embeddedData[pkg];
		if (!packageData) {
			throw new Error(`the binary ships no migrations for ${pkg}`);
		}

		switch (subcommand) {
			case "apply": {
				const dbConfig = loadDatabaseConfig();
				const migrations = packageData.migrationsByProvider[dbConfig.provider];
				if (!migrations) {
					throw new Error(`${pkg} ships no ${dbConfig.provider} migrations`);
				}
				await migrateApply({
					source: migrationSource(migrations),
					migrationsTable: packageData.migrationsTable,
					db: dbConfig,
				});
				return;
			}
			case "list": {
				const dbProvider = loadDatabaseProvider();
				const migrations = packageData.migrationsByProvider[dbProvider];
				if (!migrations) {
					throw new Error(`${pkg} ships no ${dbProvider} migrations`);
				}
				migrateList({ source: migrationSource(migrations), dbProvider });
				return;
			}
			default:
				subcommand satisfies never;
		}
	});

cli
	.command("server [subcommand]", "Run the Aiki server (start)")
	.example((name) => `  $ ${name} server start   start the server in this process`)
	.action(async (subcommand: string | undefined) => {
		if (subcommand === undefined) {
			cli.outputHelp();
			return;
		}
		if (subcommand !== "start") {
			throw new Error(`Unknown server subcommand "${subcommand}". Expected: start.`);
		}
		await startAppServer();
	});

cli.help();
cli.version(packageJson.version);

try {
	cli.parse(process.argv, { run: false });
	await cli.runMatchedCommand();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
