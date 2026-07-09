// biome-ignore-all lint/suspicious/noConsole: build script — prints build output
// Packs every migration-bearing package's migrations into cli/src/embedded.data,
// which the aiki binary embeds at compile time and reads at startup.
// Runs as part of the cli build, before the binary is compiled.
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS_TABLE as IAM_MIGRATIONS_TABLE } from "@aikirun/iam/infra/db/migrate";
import { DATABASE_PROVIDERS } from "@aikirun/lib/db";
import { readMigrationsDirectory } from "@aikirun/lib/db/migrate";
import { MIGRATIONS_TABLE as SERVER_MIGRATIONS_TABLE } from "@aikirun/server/infra/db/migrate";
import { PACKAGES, type Package } from "cli/src/packages";

import type { EmbeddedData, EmbeddedPackageData } from "../src/embedded";

const repoDir = path.resolve(import.meta.dirname, "../..");

const migrationsTables: Record<Package, string> = {
	server: SERVER_MIGRATIONS_TABLE,
	iam: IAM_MIGRATIONS_TABLE,
};

const embeddedData: EmbeddedData = {
	version: "1",
	data: {},
};

for (const pkg of PACKAGES) {
	const dbDir = path.join(repoDir, "sdk", pkg, "src", "infra", "db");
	const migrationsByProvider: EmbeddedPackageData["migrationsByProvider"] = {};
	for (const provider of DATABASE_PROVIDERS) {
		const migrationsDir = path.join(dbDir, provider, "migration");
		if (!fs.existsSync(migrationsDir)) {
			continue;
		}
		migrationsByProvider[provider] = readMigrationsDirectory(migrationsDir);
	}
	embeddedData.data[pkg] = { migrationsTable: migrationsTables[pkg], migrationsByProvider };
	console.log(`  ${pkg}: db providers [${Object.keys(migrationsByProvider).join(", ")}]`);
}

const outputPath = path.join(import.meta.dirname, "..", "src", "embedded.data");
fs.writeFileSync(outputPath, JSON.stringify(embeddedData));
console.log(`  wrote ${outputPath}`);
