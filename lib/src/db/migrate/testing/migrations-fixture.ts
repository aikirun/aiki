import { runSql as runSqlAgainst } from "./sql";
import { loadDatabaseConfig } from "../../config";
import type { Migrations } from "../source";

export { fromDatabaseBigint } from "./sql";

const dbConfig = loadDatabaseConfig();

export function qualifiedMigrationsTable(migrationsTable: string): string {
	switch (dbConfig.provider) {
		case "sqlite":
			return `"${migrationsTable}"`;
		case "pg":
			return `drizzle."${migrationsTable}"`;
		default:
			return dbConfig satisfies never;
	}
}

export interface MigrationsFixture {
	widgetTable: string;
	migrationsTable: string;
	createWidgetSql: string;
	insertWidgetSql: string;
	migrations: Migrations;
	firstMigrationOnly: Migrations;
}

// Each test gets a widget table and a migrations table of its own, so tests share nothing with each
// other or with the migrated schema. Both tables are dropped once the test finishes.
export async function withMigrationsFixture(fn: (fixture: MigrationsFixture) => Promise<void>): Promise<void> {
	const tableSuffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	const widgetTable = `migrate_widget_${tableSuffix}`;
	const migrationsTable = `migrate_migrations_${tableSuffix}`;
	const createWidgetSql = `CREATE TABLE ${widgetTable} (id text PRIMARY KEY)`;
	const insertWidgetSql = `INSERT INTO ${widgetTable} (id) VALUES ('first-widget')`;
	try {
		await fn({
			widgetTable,
			migrationsTable,
			createWidgetSql,
			insertWidgetSql,
			migrations: {
				journal: {
					entries: [
						{ tag: "0000_create_widget", when: 1_700_000_000_000 },
						{ tag: "0001_insert_widget", when: 1_700_000_001_000 },
					],
				},
				files: { "0000_create_widget": createWidgetSql, "0001_insert_widget": insertWidgetSql },
			},
			firstMigrationOnly: {
				journal: { entries: [{ tag: "0000_create_widget", when: 1_700_000_000_000 }] },
				files: { "0000_create_widget": createWidgetSql },
			},
		});
	} finally {
		await runSql(`DROP TABLE IF EXISTS ${widgetTable}`);
		await runSql(`DROP TABLE IF EXISTS ${qualifiedMigrationsTable(migrationsTable)}`);
	}
}

// Creates a migrations table in the legacy format, which has no tag column.
export async function createLegacyMigrationsTable(migrationsTable: string): Promise<void> {
	switch (dbConfig.provider) {
		case "sqlite":
			await runSql(
				`CREATE TABLE "${migrationsTable}" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at integer)`
			);
			return;
		case "pg":
			await runSql("CREATE SCHEMA IF NOT EXISTS drizzle");
			await runSql(
				`CREATE TABLE drizzle."${migrationsTable}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
			);
			return;
		default:
			dbConfig satisfies never;
	}
}

export async function runSql(statement: string): Promise<Record<string, unknown>[]> {
	return runSqlAgainst(dbConfig, statement);
}
