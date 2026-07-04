import { cac } from "cac";

import { migrateApply } from "./commands/migrate-apply";
import { migrateGenerate } from "./commands/migrate-generate";
import { migrateList } from "./commands/migrate-list";
import { isSupportedPackage, SUPPORTED_PACKAGES, type SupportedPackage } from "./lib/resolve-package";
import pkg from "../package.json" with { type: "json" };

const MIGRATE_SUBCOMMANDS = ["apply", "generate", "list"] as const;
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
	package?: string;
	custom?: boolean;
	envFile?: string;
}

function requirePackage(value: string | undefined): SupportedPackage {
	if (value === undefined) {
		throw new Error(`Missing required option --package. Expected one of: ${SUPPORTED_PACKAGES.join(", ")}.`);
	}
	if (!isSupportedPackage(value)) {
		throw new Error(`Unknown package "${value}". Expected one of: ${SUPPORTED_PACKAGES.join(", ")}.`);
	}
	return value;
}

const cli = cac("aiki");

cli
	.command("migrate [subcommand]", "Database migration commands (apply | generate | list)")
	.option(`--package <name>`, `Target package: ${SUPPORTED_PACKAGES.join(" | ")} (required)`)
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

		const targetPackage = requirePackage(options.package);

		switch (subcommand) {
			case "apply":
				await migrateApply({ pkg: targetPackage, envFile: options.envFile });
				return;
			case "generate":
				await migrateGenerate({ pkg: targetPackage, custom: options.custom, envFile: options.envFile });
				return;
			case "list":
				await migrateList({ pkg: targetPackage, envFile: options.envFile });
				return;
			default:
				subcommand satisfies never;
		}
	});

cli.help();
cli.version(pkg.version);
cli.parse();
