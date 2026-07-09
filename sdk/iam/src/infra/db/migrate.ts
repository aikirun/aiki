import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConfig, DatabaseProvider } from "@aikirun/lib/db";
import {
	migrateApply as _migrateApply,
	migrationSource as _migrationSource,
	type MigrationSource,
	readMigrationsDirectory,
} from "@aikirun/lib/db/migrate";

export const MIGRATIONS_TABLE = "__drizzle_migrations__iam";

// This package's migration files for the given provider.
// Resolves relative to the dist root the published build places this code at.
export function migrationSource(provider: DatabaseProvider): MigrationSource {
	const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "infra", "db", provider, "migration");
	return _migrationSource(readMigrationsDirectory(migrationsDir));
}

export interface MigrateApplyParams {
	db: DatabaseConfig;
}

// Applies this package's bundled database migrations.
export async function migrateApply(params: MigrateApplyParams): Promise<void> {
	await _migrateApply({
		source: migrationSource(params.db.provider),
		migrationsTable: MIGRATIONS_TABLE,
		db: params.db,
	});
}
