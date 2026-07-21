import process from "node:process";
import { cac } from "cac";
import { config as loadEnv } from "dotenv";

import { migrateApply } from "./commands/apply";
import { migrateList } from "./commands/list";
import type { MigrationSource } from "./source";
import { loadDatabaseConfig, loadDatabaseProvider } from "../config";
import type { DatabaseProvider } from "../provider";

export const MIGRATE_SUBCOMMANDS = ["apply", "list"] as const;
export type MigrateSubcommand = (typeof MIGRATE_SUBCOMMANDS)[number];

export function isMigrateSubcommand(value: string): value is MigrateSubcommand {
	for (const subcommand of MIGRATE_SUBCOMMANDS) {
		if (subcommand === value) {
			return true;
		}
	}
	return false;
}

export const MIGRATE_SUBCOMMAND_HELP: Record<MigrateSubcommand, string> = {
	apply: "Apply pending migrations to the database",
	list: "List the migrations this package ships",
};

export interface MigrateCliParams {
	name: string;
	version: string;
	resolveSource: (provider: DatabaseProvider) => MigrationSource;
	migrationsTable: string;
}

export async function runMigrateCli(params: MigrateCliParams): Promise<void> {
	const cli = cac(params.name);

	cli
		.command("migrate [subcommand]", "Database migration commands (apply | list)")
		.option("--env-file <path>", "Path to env file")
		.example((name) => `  $ ${name} migrate apply    apply pending migrations to the database`)
		.example((name) => `  $ ${name} migrate list     list the migrations this package ships`)
		.action(async (subcommand: string | undefined, options: { envFile?: string }) => {
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
				loadEnv({ path: options.envFile });
			}

			switch (subcommand) {
				case "apply": {
					const dbConfig = loadDatabaseConfig();
					await migrateApply({
						source: params.resolveSource(dbConfig.provider),
						migrationsTable: params.migrationsTable,
						db: dbConfig,
					});
					return;
				}
				case "list": {
					const dbProvider = loadDatabaseProvider();
					migrateList({ source: params.resolveSource(dbProvider), dbProvider });
					return;
				}
				default:
					subcommand satisfies never;
			}
		});

	cli.help((sections) => {
		if (cli.matchedCommand?.name !== "migrate") {
			return sections;
		}
		const longestName = MIGRATE_SUBCOMMANDS.reduce((longest, subcommand) => Math.max(longest, subcommand.length), 0);
		const body = MIGRATE_SUBCOMMANDS.map(
			(subcommand) => `  ${subcommand.padEnd(longestName)}  ${MIGRATE_SUBCOMMAND_HELP[subcommand]}`
		).join("\n");
		const usageIndex = sections.findIndex((section) => section.title === "Usage");
		sections.splice(usageIndex + 1, 0, { title: "Commands", body });
		return sections;
	});
	cli.version(params.version);

	try {
		cli.parse(process.argv, { run: false });
		if (cli.matchedCommand) {
			await cli.runMatchedCommand();
		} else if (!cli.options.help && !cli.options.version) {
			cli.outputHelp();
		}
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
