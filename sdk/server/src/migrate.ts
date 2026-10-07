import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConfig, DatabaseProvider } from "@aikirun/lib/db";
import {
	migrateApply as _migrateApply,
	migrationSource as _migrationSource,
	type MigrationJournal,
	type MigrationSource,
	readMigrationsDirectory,
} from "@aikirun/lib/db/migrate";
import { consoleLogger, type Logger } from "@aikirun/lib/logger";

import pgJournal from "./infra/db/pg/migration/meta/_journal.json" with { type: "json" };
import sqliteJournal from "./infra/db/sqlite/migration/meta/_journal.json" with { type: "json" };

export const MIGRATIONS_TABLE = "__drizzle_migrations__server";

// This package's migration files for the given provider.
// Resolves relative to the dist root the published build places this code at.
export function migrationSource(provider: DatabaseProvider): MigrationSource {
	const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "infra", "db", provider, "migration");
	return _migrationSource(readMigrationsDirectory(migrationsDir));
}

// This package's migration journal for the given provider. It is compiled into the build, so it is
// there even where the migration files are not.
export function migrationJournal(provider: DatabaseProvider): MigrationJournal {
	switch (provider) {
		case "sqlite":
			return sqliteJournal;
		case "pg":
			return pgJournal;
		default:
			return provider satisfies never;
	}
}

export interface MigrateApplyParams {
	db: DatabaseConfig;
	logger?: Logger;
}

// Applies this package's bundled database migrations.
export async function migrateApply(params: MigrateApplyParams): Promise<void> {
	await _migrateApply({
		source: migrationSource(params.db.provider),
		migrationsTable: MIGRATIONS_TABLE,
		db: params.db,
		logger: params.logger ?? consoleLogger(),
	});
}
