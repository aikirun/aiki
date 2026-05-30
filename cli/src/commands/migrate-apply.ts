import path from "node:path";
import { ConsoleLogger } from "@aikirun/lib/logger";

import { loadDatabaseConfig, type PgDatabaseConfig, type SqliteDatabaseConfig } from "../lib/db-config";
import { loadEnv } from "../lib/env";
import { resolvePackageRoot, type SupportedPackage } from "../lib/resolve-package";

interface MigrateApplyOptions {
	pkg: SupportedPackage;
	envFile?: string;
}

export async function migrateApply(options: MigrateApplyOptions): Promise<void> {
	loadEnv(options.envFile);
	const dbConfig = loadDatabaseConfig();

	const packageRoot = resolvePackageRoot(options.pkg);
	const migrationsFolder = path.join(packageRoot, "dist", "infra", "db", dbConfig.provider, "migration");
	const migrationsTable = `__drizzle_migrations__${options.pkg}`;
	const logger = new ConsoleLogger();

	switch (dbConfig.provider) {
		case "pg":
			await applyPg(dbConfig, migrationsFolder, migrationsTable, logger);
			break;
		case "sqlite":
			await applySqlite(dbConfig, migrationsFolder, migrationsTable, logger);
			break;
		case "mysql":
			throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported by aiki migrate.`);
		default:
			dbConfig satisfies never;
	}
}

async function applyPg(
	config: PgDatabaseConfig,
	migrationsFolder: string,
	migrationsTable: string,
	logger: ConsoleLogger
): Promise<void> {
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
			CREATE TABLE IF NOT EXISTS drizzle.${sql.identifier(migrationsTable)} (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`);

		const applied = await db.execute<{ hash: string }>(
			sql`SELECT hash FROM drizzle.${sql.identifier(migrationsTable)}`
		);
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
					sql`INSERT INTO drizzle.${sql.identifier(migrationsTable)} (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`
				);
			});
		}

		logger.info("Migrations applied");
	} finally {
		await client.end();
	}
}

async function applySqlite(
	config: SqliteDatabaseConfig,
	migrationsFolder: string,
	migrationsTable: string,
	logger: ConsoleLogger
): Promise<void> {
	const { Database } = await import("bun:sqlite");
	const { drizzle } = await import("drizzle-orm/bun-sqlite");
	const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");

	const client = new Database(config.path);
	client.exec("PRAGMA journal_mode = WAL");
	client.exec("PRAGMA foreign_keys = ON");

	try {
		migrate(drizzle(client), { migrationsFolder, migrationsTable });
		logger.info("Migrations applied");
	} finally {
		client.close();
	}
}
