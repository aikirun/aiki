import { cac } from "cac";

import { migrateApply } from "./commands/migrate-apply";
import { migrateGenerate } from "./commands/migrate-generate";
import pkg from "../package.json" with { type: "json" };

const MIGRATE_SUBCOMMANDS = ["apply", "generate"] as const;
type MigrateSubcommand = (typeof MIGRATE_SUBCOMMANDS)[number];

function isMigrateSubcommand(value: string): value is MigrateSubcommand {
	for (const sub of MIGRATE_SUBCOMMANDS) {
		if (sub === value) {
			return true;
		}
	}
	return false;
}

interface MigrateOptions {
	custom?: boolean;
	envFile?: string;
}

const cli = cac("aiki");

cli
	.command("migrate [subcommand]", "Database migration commands (apply | generate)")
	.option("--custom", "Generate a custom SQL stub (only valid with `generate`)")
	.option("--env-file <path>", "Path to env file")
	.action(async (subcommand: string | undefined, options: MigrateOptions) => {
		if (subcommand === undefined) {
			cli.outputHelp();
			return;
		}

		if (!isMigrateSubcommand(subcommand)) {
			throw new Error(
				`Unknown migrate subcommand "${subcommand}". Expected one of: ${MIGRATE_SUBCOMMANDS.join(", ")}.`
			);
		}

		switch (subcommand) {
			case "apply":
				await migrateApply({ envFile: options.envFile });
				return;
			case "generate":
				await migrateGenerate({ custom: options.custom, envFile: options.envFile });
				return;
			default:
				subcommand satisfies never;
		}
	});

cli.help();
cli.version(pkg.version);
cli.parse();
