import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseConfig } from "@aikirun/lib/db";
import { migrateApply as _migrateApply } from "@aikirun/lib/migrate";

export const MIGRATIONS_TABLE = "__drizzle_migrations__iam";

export interface MigrateApplyParams {
	db: DatabaseConfig;
}

// Applies this package's bundled database migrations.
export async function migrateApply(params: MigrateApplyParams): Promise<void> {
	const db = params.db;
	const migrationsDir = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"infra",
		"db",
		db.provider,
		"migration"
	);

	await _migrateApply({ migrationsDir, migrationsTable: MIGRATIONS_TABLE, db });
}
