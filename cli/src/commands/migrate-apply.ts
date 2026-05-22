import { ConsoleLogger } from "@aikirun/lib/logger";
import { loadDatabaseConfig, type PgDatabaseConfig } from "@aikirun/server/config";

import { loadEnv } from "../lib/env";
import { resolveServerMigrationsDir } from "../lib/resolve-server";

interface MigrateApplyOptions {
	envFile?: string;
}

export async function migrateApply(options: MigrateApplyOptions): Promise<void> {
	loadEnv(options.envFile);

	const dbConfig = loadDatabaseConfig();
	const migrationsFolder = resolveServerMigrationsDir(dbConfig.provider);
	const logger = new ConsoleLogger();

	switch (dbConfig.provider) {
		case "pg":
			await applyPg(dbConfig, migrationsFolder, logger);
			break;
		case "sqlite":
		case "mysql":
			throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported by aiki migrate.`);
		default:
			dbConfig satisfies never;
	}
}

async function applyPg(config: PgDatabaseConfig, migrationsFolder: string, logger: ConsoleLogger): Promise<void> {
	const { sql } = await import("drizzle-orm");
	const { readMigrationFiles } = await import("drizzle-orm/migrator");
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const { default: postgres } = await import("postgres");

	const client = postgres(config.url, {
		max: 1,
		ssl: config.ssl ? "require" : undefined,
	});

	const db = drizzle(client);

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

		logger.info("Migrations applied");
	} finally {
		await client.end();
	}
}
