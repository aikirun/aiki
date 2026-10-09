import { describe, expect, test } from "vitest";

import { migrateApply } from "./apply";
import { migrateReset } from "./reset";
import { sha256 } from "../../../crypto";
import { noopLogger } from "../../../logger";
import { loadDatabaseConfig } from "../../config";
import { type Migrations, migrationSource } from "../source";
import { fromDatabaseBigint, qualifiedMigrationsTable, runSql } from "../testing/migrations-fixture";

const dbConfig = loadDatabaseConfig();

describe("migrateReset", () => {
	test("drops tables and migrations bookkeeping so apply runs from scratch", () =>
		withResetFixture(async (fixture) => {
			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
				logger: noopLogger,
			});

			await migrateReset({
				db: dbConfig,
				migrationsTable: fixture.migrationsTable,
				...(fixture.schema ? { schemas: [fixture.schema] } : { tables: [fixture.widgetTable] }),
			});

			expect(await listFixtureTables(fixture)).toEqual([]);
			expect(await migrationsTableExists(fixture.migrationsTable)).toBe(false);

			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
				logger: noopLogger,
			});

			expect(await runSql(`SELECT id FROM ${fixture.qualifiedWidgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(
				await runSql(
					`SELECT tag, hash, created_at FROM ${qualifiedMigrationsTable(fixture.migrationsTable)} ORDER BY tag`
				)
			).toEqual([
				{
					tag: "0000_create_widget",
					hash: sha256(fixture.createWidgetSql),
					created_at: fromDatabaseBigint(1_700_000_000_000),
				},
				{
					tag: "0001_insert_widget",
					hash: sha256(fixture.insertWidgetSql),
					created_at: fromDatabaseBigint(1_700_000_001_000),
				},
			]);
		}));
});

interface ResetFixture {
	schema: string | undefined;
	widgetTable: string;
	qualifiedWidgetTable: string;
	migrationsTable: string;
	createWidgetSql: string;
	insertWidgetSql: string;
	migrations: Migrations;
}

// Owns a schema on Postgres (or uniquely named tables on SQLite) so reset does not touch the
// shared testing database's migrated schema.
async function withResetFixture(fn: (fixture: ResetFixture) => Promise<void>): Promise<void> {
	const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	const schema = dbConfig.provider === "pg" ? `migrate_reset_${suffix}` : undefined;
	const widgetTable = schema ? "widget" : `migrate_reset_widget_${suffix}`;
	const qualifiedWidgetTable = schema ? `"${schema}"."${widgetTable}"` : `"${widgetTable}"`;
	const migrationsTable = `migrate_reset_migrations_${suffix}`;
	const createWidgetSql = `CREATE TABLE ${qualifiedWidgetTable} (id text PRIMARY KEY)`;
	const insertWidgetSql = `INSERT INTO ${qualifiedWidgetTable} (id) VALUES ('first-widget')`;

	await ensureFixtureSchema(schema);
	try {
		await fn({
			schema,
			widgetTable,
			qualifiedWidgetTable,
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
		});
	} finally {
		if (schema) {
			await runSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		} else {
			await runSql(`DROP TABLE IF EXISTS "${widgetTable}"`);
		}
		await runSql(`DROP TABLE IF EXISTS ${qualifiedMigrationsTable(migrationsTable)}`);
	}
}

async function ensureFixtureSchema(schema: string | undefined): Promise<void> {
	if (schema) {
		await runSql(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
	}
}

async function listFixtureTables(fixture: ResetFixture): Promise<string[]> {
	switch (dbConfig.provider) {
		case "sqlite": {
			const rows = await runSql(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${fixture.widgetTable}'`
			);
			return rows.map((row) => String(row.name));
		}
		case "pg": {
			const rows = await runSql(
				`SELECT tablename FROM pg_tables WHERE schemaname = '${fixture.schema}' ORDER BY tablename`
			);
			return rows.map((row) => String(row.tablename));
		}
		default:
			return dbConfig satisfies never;
	}
}

async function migrationsTableExists(migrationsTable: string): Promise<boolean> {
	switch (dbConfig.provider) {
		case "sqlite": {
			const rows = await runSql(
				`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = '${migrationsTable}'`
			);
			return rows.length > 0;
		}
		case "pg": {
			const rows = await runSql(
				`SELECT 1 AS present FROM information_schema.tables WHERE table_schema = 'drizzle' AND table_name = '${migrationsTable}'`
			);
			return rows.length > 0;
		}
		default:
			return dbConfig satisfies never;
	}
}
