// biome-ignore-all lint/suspicious/noConsole: this prints command output, not logs
import process from "node:process";
import { cac } from "cac";
import { config as dotenvConfig } from "dotenv";

import { migrateApply } from "./commands/apply";
import { migrateList } from "./commands/list";
import { loadDatabaseConfig, loadDatabaseProvider } from "../config";
import type { DatabaseProvider } from "../provider";

const MIGRATE_SUBCOMMANDS = ["apply", "list"] as const;
type MigrateSubcommand = (typeof MIGRATE_SUBCOMMANDS)[number];

function isMigrateSubcommand(value: string): value is MigrateSubcommand {
	for (const subcommand of MIGRATE_SUBCOMMANDS) {
		if (subcommand === value) {
			return true;
		}
	}
	return false;
}

export interface MigrateCliParams {
	name: string;
	version: string;
	resolveMigrationsDir: (provider: DatabaseProvider) => string;
	migrationsTable: string;
}

export function runMigrateCli(params: MigrateCliParams): void {
	const cli = cac(params.name);

	cli
		.command("migrate [subcommand]", "Database migration commands (apply | list)")
		.option("--env-file <path>", "Path to env file")
		.example((name) => `  $ ${name} migrate apply    apply pending migrations to the database`)
		.example((name) => `  $ ${name} migrate list     list the migrations this package ships`)
		.action(async (subcommand: string | undefined, options: { envFile?: string }) => {
			try {
				if (subcommand === undefined) {
					cli.outputHelp();
					return;
				}

				if (!isMigrateSubcommand(subcommand)) {
					throw new Error(
						`Unknown migrate subcommand "${subcommand}". Expected one of: ${MIGRATE_SUBCOMMANDS.join(", ")}.`
					);
				}

				if (options.envFile) {
					dotenvConfig({ path: options.envFile });
				}

				switch (subcommand) {
					case "apply": {
						const dbConfig = loadDatabaseConfig();
						await migrateApply({
							migrationsDir: params.resolveMigrationsDir(dbConfig.provider),
							migrationsTable: params.migrationsTable,
							db: dbConfig,
						});
						return;
					}
					case "list": {
						const dbProvider = loadDatabaseProvider();
						await migrateList({
							migrationsDir: params.resolveMigrationsDir(dbProvider),
							dbProvider,
						});
						return;
					}
					default:
						subcommand satisfies never;
				}
			} catch (error) {
				console.error(error instanceof Error ? error.message : String(error));
				process.exit(1);
			}
		});

	cli.help();
	cli.version(params.version);
	cli.parse();
}
