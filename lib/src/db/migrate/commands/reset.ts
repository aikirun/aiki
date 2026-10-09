import type { DatabaseConfig, PgDatabaseConfig, SqliteDatabaseConfig } from "../../config";

interface MigrateResetParams {
	db: DatabaseConfig;
	/**
	 * Postgres schemas to drop and recreate empty. Defaults to `["public"]`.
	 * Ignored on SQLite.
	 */
	schemas?: readonly string[];
	/**
	 * Migrations bookkeeping table to drop. On Postgres it lives in `migrationsSchema`
	 * (default `drizzle`); on SQLite it is a top-level table.
	 */
	migrationsTable?: string;
	/** Postgres schema that holds `migrationsTable`. Defaults to `drizzle`. */
	migrationsSchema?: string;
	/**
	 * SQLite tables to drop. When omitted, every user table is dropped.
	 * Ignored on Postgres.
	 */
	tables?: readonly string[];
}

/**
 * Wipes database schemas / tables and clears migrations bookkeeping so
 * `migrate apply` will re-run from scratch.
 *
 * Postgres drops each of `schemas` (default `public`) and recreates them empty,
 * then drops `migrationsSchema.migrationsTable` when `migrationsTable` is set.
 * SQLite drops `tables` when set, otherwise every user table, then drops
 * `migrationsTable` when set.
 */
export async function migrateReset(params: MigrateResetParams): Promise<void> {
	const dbConfig: DatabaseConfig = params.db;

	switch (dbConfig.provider) {
		case "pg":
			await resetPg(dbConfig, params);
			return;
		case "sqlite":
			await resetSqlite(dbConfig, params);
			return;
		// case "mysql":
		// 	throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported for migrate reset.`);
		default:
			dbConfig satisfies never;
	}
}

async function resetSqlite(
	config: SqliteDatabaseConfig,
	params: Pick<MigrateResetParams, "migrationsTable" | "tables">
): Promise<void> {
	const { openSqliteClient } = await import("../../sqlite");
	const client = await openSqliteClient(config);

	try {
		const tableNames = params.tables
			? [...params.tables]
			: (
					await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
				).rows.map(([name]) => String(name));

		if (tableNames.length > 0) {
			console.log(`dropping tables ${tableNames.join(", ")}`);
			await client.execute("PRAGMA foreign_keys = OFF");
			try {
				for (const tableName of tableNames) {
					await client.execute(`DROP TABLE IF EXISTS "${tableName}"`);
				}
			} finally {
				await client.execute("PRAGMA foreign_keys = ON");
			}
		}

		if (params.migrationsTable) {
			console.log(`clearing migrations table ${params.migrationsTable}`);
			await client.execute(`DROP TABLE IF EXISTS "${params.migrationsTable}"`);
		}
	} finally {
		client.close();
	}
}

async function resetPg(
	config: PgDatabaseConfig,
	params: Pick<MigrateResetParams, "schemas" | "migrationsTable" | "migrationsSchema">
): Promise<void> {
	const { sql } = await import("drizzle-orm");
	const postgres = await importPostgres();
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const client = postgres(config.url, {
		max: 1,
		ssl: config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : undefined,
	});
	const db = drizzle(client);
	const schemas = params.schemas ?? ["public"];
	const migrationsSchema = params.migrationsSchema ?? "drizzle";

	try {
		for (const schema of schemas) {
			console.log(`dropping schema ${schema}`);
			await db.execute(sql`DROP SCHEMA IF EXISTS ${sql.identifier(schema)} CASCADE`);
			await db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
		}

		if (params.migrationsTable) {
			console.log(`clearing migrations table ${migrationsSchema}.${params.migrationsTable}`);
			await db.execute(
				sql`DROP TABLE IF EXISTS ${sql.identifier(migrationsSchema)}.${sql.identifier(params.migrationsTable)}`
			);
		}
	} finally {
		await client.end();
	}
}

async function importPostgres() {
	try {
		const { default: postgres } = await import("postgres");
		return postgres;
	} catch {
		throw new Error("the pg provider requires the postgres driver, install it with: npm install postgres");
	}
}
