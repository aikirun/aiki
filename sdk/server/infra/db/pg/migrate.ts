import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger } from "@aikirun/lib/logger";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { createPgDatabaseConn, type PgDatabaseOptions } from "./provider";
import type { PgDatabaseConfig } from "../../../config";

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migration");

export async function migratePg(options: PgDatabaseOptions | PgDatabaseConfig, logger: Logger): Promise<void> {
	const db = createPgDatabaseConn({ ...options, maxConnections: 1 });

	try {
		await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
		await db.execute(sql`
			CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`);

		const applied = await db.execute<{ hash: string }>(sql`SELECT hash FROM drizzle.__drizzle_migrations`);
		const appliedHashes = new Set(applied.map((row) => row.hash));

		const migrations = readMigrationFiles({ migrationsFolder });

		for (const migration of migrations) {
			if (appliedHashes.has(migration.hash)) {
				continue;
			}

			logger.info("applying migration", { hash: migration.hash.slice(0, 12) });

			await db.transaction(async (tx) => {
				for (const statement of migration.sql) {
					await tx.execute(sql.raw(statement));
				}
				await tx.execute(
					sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`
				);
			});
		}
	} finally {
		await db.$client.end();
	}
}
