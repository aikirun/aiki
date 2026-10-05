import type { DatabaseConfig, PgDatabaseConfig, SqliteDatabaseConfig } from "../../config";

interface MigrateResetParams {
	migrationsTable: string;
	db: DatabaseConfig;
}

/**
 * Wipes the database schema and clears this package's migrations bookkeeping
 * table so `migrate apply` will re-run from scratch.
 *
 * Postgres drops `public` and this package's `drizzle` migrations table.
 * SQLite drops every user table (migrations bookkeeping lives alongside them).
 */
export async function migrateReset(params: MigrateResetParams): Promise<void> {
	const dbConfig: DatabaseConfig = params.db;

	switch (dbConfig.provider) {
		case "pg":
			await resetPg(dbConfig, params.migrationsTable);
			return;
		case "sqlite":
			await resetSqlite(dbConfig, params.migrationsTable);
			return;
		// case "mysql":
		// 	throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported for migrate reset.`);
		default:
			dbConfig satisfies never;
	}
}

async function resetSqlite(config: SqliteDatabaseConfig, migrationsTable: string): Promise<void> {
	const { openSqliteClient } = await import("../../sqlite");
	const client = await openSqliteClient(config);

	try {
		console.log("dropping all tables");
		const tables = await client.execute(
			`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
		);
		const tableNames = tables.rows.map((row) => String(row.name));
		if (tableNames.length > 0) {
			await client.execute("PRAGMA foreign_keys = OFF");
			try {
				for (const tableName of tableNames) {
					await client.execute(`DROP TABLE IF EXISTS "${tableName}"`);
				}
			} finally {
				await client.execute("PRAGMA foreign_keys = ON");
			}
		}

		console.log(`clearing migrations table ${migrationsTable}`);
		await client.execute(`DROP TABLE IF EXISTS "${migrationsTable}"`);
	} finally {
		client.close();
	}
}

async function resetPg(config: PgDatabaseConfig, migrationsTable: string): Promise<void> {
	const { sql } = await import("drizzle-orm");
	const postgres = await importPostgres();
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const client = postgres(config.url, {
		max: 1,
		ssl: config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : undefined,
	});
	const db = drizzle(client);

	try {
		console.log("dropping schema public");
		await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
		await db.execute(sql`CREATE SCHEMA public`);

		console.log(`clearing migrations table ${migrationsTable}`);
		await db.execute(sql`DROP TABLE IF EXISTS drizzle.${sql.identifier(migrationsTable)}`);
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
