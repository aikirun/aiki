import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";

import { migrateApply } from "./apply";
import { migrateReset } from "./reset";
import { sha256 } from "../../../crypto";
import { type Migrations, migrationSource } from "../source";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-reset-"));
const dbPath = path.join(tempDir, "reset.db");
const db = { provider: "sqlite" as const, path: dbPath };

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe("migrateReset sqlite", () => {
	test("drops tables and migrations bookkeeping so apply runs from scratch", async () => {
		const migrationsTable = "migrate_reset_migrations";
		const createWidgetSql = "CREATE TABLE migrate_reset_widget (id text PRIMARY KEY)";
		const insertWidgetSql = "INSERT INTO migrate_reset_widget (id) VALUES ('first-widget')";
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
		});

		await migrateReset({ migrationsTable, db });

		expect(await listUserTables()).toEqual([]);

		await migrateApply({
			source: migrationSource(migrations),
			migrationsTable,
			db,
		});

		expect(await readRows("SELECT id FROM migrate_reset_widget")).toEqual([{ id: "first-widget" }]);
		expect(await readRows(`SELECT tag, hash, created_at FROM "${migrationsTable}" ORDER BY tag`)).toEqual([
			{ tag: "0000_create_widget", hash: sha256(createWidgetSql), created_at: 1_700_000_000_000 },
			{ tag: "0001_insert_widget", hash: sha256(insertWidgetSql), created_at: 1_700_000_001_000 },
		]);
	});
});

async function listUserTables(): Promise<string[]> {
	const rows = await readRows(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
	);
	return rows.map((row) => String(row.name));
}

async function readRows(statement: string): Promise<Record<string, unknown>[]> {
	const { openSqliteClient } = await import("../../sqlite");
	const client = await openSqliteClient(db);
	try {
		const queryResult = await client.execute(statement);
		return queryResult.rows.map((row) =>
			Object.fromEntries(queryResult.columns.map((column) => [column, row[column]]))
		);
	} finally {
		client.close();
	}
}
