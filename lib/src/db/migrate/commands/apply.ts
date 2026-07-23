import type { DatabaseConfig, PgDatabaseConfig } from "../../config";
import type { MigrationMeta, MigrationSource } from "../source";

interface MigrateApplyParams {
	source: MigrationSource;
	migrationsTable: string;
	db: DatabaseConfig;
}

export async function migrateApply(params: MigrateApplyParams): Promise<void> {
	const dbConfig = params.db;

	switch (dbConfig.provider) {
		case "pg":
			await applyPg(dbConfig, params.source.read(), params.migrationsTable);
			return;
		// case "sqlite":
		// case "mysql":
		// 	throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported.`);
		default:
			dbConfig.provider satisfies never;
	}
}

async function applyPg(config: PgDatabaseConfig, migrations: MigrationMeta[], migrationsTable: string): Promise<void> {
	const { sql } = await import("drizzle-orm");
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const postgres = await importPostgres();
	const client = postgres(config.url, {
		max: 1,
		ssl: config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : undefined,
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

		for (const migration of migrations) {
			if (appliedHashes.has(migration.hash)) {
				continue;
			}

			console.log(`applying migration ${migration.hash.slice(0, 12)}`);

			await db.transaction(async (tx) => {
				for (const statement of migration.sql) {
					await tx.execute(sql.raw(statement));
				}
				await tx.execute(
					sql`INSERT INTO drizzle.${sql.identifier(migrationsTable)} (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`
				);
			});
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
