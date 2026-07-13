// biome-ignore-all lint/suspicious/noConsole: build script — prints build output
// Packs every migration-bearing package's migrations into cli/src/embedded-migration.data,
// which the aiki binary embeds at compile time and reads at startup.
// Runs as part of the cli build, before the binary is compiled.
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS_TABLE as IAM_MIGRATIONS_TABLE } from "@aikirun/iam/migrate";
import { DATABASE_PROVIDERS } from "@aikirun/lib/db";
import { readMigrationsDirectory } from "@aikirun/lib/db/migrate";
import { MIGRATIONS_TABLE as SERVER_MIGRATIONS_TABLE } from "@aikirun/server/migrate";
import {
	type EmbeddedMigrationData,
	type EmbeddedPackageMigrationData,
	MIGRATION_PACKAGES,
	type MigrationPackage,
} from "cli/src/embedded/migration";

const repoDir = path.resolve(import.meta.dirname, "../..");

const migrationsTables: Record<MigrationPackage, string> = {
	server: SERVER_MIGRATIONS_TABLE,
	iam: IAM_MIGRATIONS_TABLE,
};

const embeddedMigrationData: EmbeddedMigrationData = {
	version: "1",
	data: {},
};

for (const pkg of MIGRATION_PACKAGES) {
	const dbDir = path.join(repoDir, "sdk", pkg, "src", "infra", "db");
	const migrationsByProvider: EmbeddedPackageMigrationData["migrationsByProvider"] = {};
	for (const provider of DATABASE_PROVIDERS) {
		const migrationsDir = path.join(dbDir, provider, "migration");
		if (!fs.existsSync(migrationsDir)) {
			continue;
		}
		migrationsByProvider[provider] = readMigrationsDirectory(migrationsDir);
	}
	embeddedMigrationData.data[pkg] = { migrationsTable: migrationsTables[pkg], migrationsByProvider };
	console.log(`  ${pkg}: db providers [${Object.keys(migrationsByProvider).join(", ")}]`);
}

const outputPath = path.join(import.meta.dirname, "..", "src", "embedded-migration.data");
fs.writeFileSync(outputPath, JSON.stringify(embeddedMigrationData));
console.log(`  wrote ${outputPath}`);
