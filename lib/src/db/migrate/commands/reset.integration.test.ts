import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { migrateApply } from "./apply";
import { migrateReset } from "./reset";
import { sha256 } from "../../../crypto";
import { noopLogger } from "../../../logger";
import { type DatabaseConfig, loadDatabaseConfig, type PgDatabaseConfig } from "../../config";
import { type Migrations, migrationSource } from "../source";
import { qualifiedMigrationsTable } from "../testing/migrations-fixture";
import { fromDatabaseBigint, runSql } from "../testing/sql";

const configuredDb = loadDatabaseConfig();

describe("migrateReset", () => {
	test("drops tables and migrations bookkeeping so apply runs from scratch", () =>
		withOwnDatabase(async (db) => {
			const migrationsTable = "migrate_reset_migrations";
			const widgetTable = "migrate_reset_widget";
			const createWidgetSql = `CREATE TABLE ${widgetTable} (id text PRIMARY KEY)`;
			const insertWidgetSql = `INSERT INTO ${widgetTable} (id) VALUES ('first-widget')`;
			const migrations: Migrations = {
				journal: {
					entries: [
						{ tag: "0000_create_widget", when: 1_700_000_000_000 },
						{ tag: "0001_insert_widget", when: 1_700_000_001_000 },
					],
				},
				files: { "0000_create_widget": createWidgetSql, "0001_insert_widget": insertWidgetSql },
			};

			await migrateApply({
				source: migrationSource(migrations),
				migrationsTable,
				db,
				logger: noopLogger,
			});

			await migrateReset({ migrationsTable, db });

			expect(await listUserTables(db)).toEqual([]);

			await migrateApply({
				source: migrationSource(migrations),
				migrationsTable,
				db,
				logger: noopLogger,
			});

			expect(await runSql(db, `SELECT id FROM ${widgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(
				await runSql(db, `SELECT tag, hash, created_at FROM ${qualifiedMigrationsTable(migrationsTable)} ORDER BY tag`)
			).toEqual([
				{
					tag: "0000_create_widget",
					hash: sha256(createWidgetSql),
					created_at: fromDatabaseBigint(1_700_000_000_000),
				},
				{
					tag: "0001_insert_widget",
					hash: sha256(insertWidgetSql),
					created_at: fromDatabaseBigint(1_700_000_001_000),
				},
			]);
		}));
});

// Reset wipes the whole database, so the suite uses a database of its own: a temp file on SQLite,
// and on Postgres a database created for the test and dropped afterwards.
async function withOwnDatabase(fn: (db: DatabaseConfig) => Promise<void>): Promise<void> {
	switch (configuredDb.provider) {
		case "sqlite": {
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-reset-"));
			const db: DatabaseConfig = { provider: "sqlite", path: path.join(tempDir, "reset.db") };
			try {
				await fn(db);
			} finally {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
			return;
		}
		case "pg": {
			const databaseName = `migrate_reset_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
			const { default: postgres } = await import("postgres");
			const adminClient = postgres(configuredDb.url, { max: 1, onnotice: () => {} });
			try {
				await adminClient.unsafe(`CREATE DATABASE ${databaseName}`);
				const db: PgDatabaseConfig = {
					...configuredDb,
					url: databaseUrlWithName(configuredDb.url, databaseName),
				};
				try {
					await fn(db);
				} finally {
					await adminClient.unsafe(
						`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`
					);
					await adminClient.unsafe(`DROP DATABASE IF EXISTS ${databaseName}`);
				}
			} finally {
				await adminClient.end();
			}
			return;
		}
		default:
			configuredDb satisfies never;
	}
}

function databaseUrlWithName(url: string, databaseName: string): string {
	const parsed = new URL(url);
	parsed.pathname = `/${databaseName}`;
	return parsed.toString();
}

async function listUserTables(db: DatabaseConfig): Promise<string[]> {
	switch (db.provider) {
		case "sqlite": {
			const rows = await runSql(
				db,
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
			);
			return rows.map((row) => String(row.name));
		}
		case "pg": {
			const rows = await runSql(db, `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
			return rows.map((row) => String(row.tablename));
		}
		default:
			return db satisfies never;
	}
}
