import type { Sql } from "postgres";

import type { SqliteClient } from "../sqlite";

export type MigrationsDatabase = { provider: "sqlite"; client: SqliteClient } | { provider: "pg"; client: Sql };

export type MigrationsTableState = "no_table" | "untagged" | "tagged";

export interface AppliedMigration {
	tag: string;
	hash: string;
}

// A migrations table without a tag column is in the legacy format.
export async function readMigrationsTableState(
	db: MigrationsDatabase,
	migrationsTable: string
): Promise<MigrationsTableState> {
	switch (db.provider) {
		case "sqlite": {
			const columns = await db.client.execute("SELECT name FROM pragma_table_info(?)", [migrationsTable]);
			if (columns.rows.length === 0) {
				return "no_table";
			}
			return columns.rows.some(([columnName]) => columnName === "tag") ? "tagged" : "untagged";
		}
		case "pg": {
			const columns = await db.client<{ columnName: string }[]>`
				SELECT column_name AS "columnName" FROM information_schema.columns
				WHERE table_schema = 'drizzle' AND table_name = ${migrationsTable}
			`;
			if (columns.length === 0) {
				return "no_table";
			}
			return columns.some((column) => column.columnName === "tag") ? "tagged" : "untagged";
		}
		default:
			return db satisfies never;
	}
}

// Reads a migrations table in the tagged format.
export async function readAppliedMigrations(
	db: MigrationsDatabase,
	migrationsTable: string
): Promise<AppliedMigration[]> {
	switch (db.provider) {
		case "sqlite": {
			const appliedRows = await db.client.execute(`SELECT tag, hash FROM "${migrationsTable}"`);
			return appliedRows.rows.map(([tag, hash]) => ({ tag: String(tag), hash: String(hash) }));
		}
		case "pg": {
			return await db.client<AppliedMigration[]>`SELECT tag, hash FROM drizzle.${db.client(migrationsTable)}`;
		}
		default:
			return db satisfies never;
	}
}
