import type { Client } from "@libsql/client";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { nestedMap } from "../../../collection/map";
import type { Logger } from "../../../logger";
import type { DatabaseConfig, PgDatabaseConfig, SqliteDatabaseConfig } from "../../config";
import {
	type AppliedMigration,
	type MigrationsDatabase,
	readAppliedMigrations,
	readMigrationsTableState,
} from "../migrations-table";
import type { MigrationMeta, MigrationSource } from "../source";

interface MigrateApplyParams {
	source: MigrationSource;
	migrationsTable: string;
	db: DatabaseConfig;
	logger: Logger;
}

export async function migrateApply(params: MigrateApplyParams): Promise<void> {
	const dbConfig = params.db;

	switch (dbConfig.provider) {
		case "sqlite":
			await applySqlite(dbConfig, params.source.read(), params.migrationsTable, params.logger);
			return;
		case "pg":
			await applyPg(dbConfig, params.source.read(), params.migrationsTable, params.logger);
			return;
		// case "mysql":
		// 	throw new Error(`DATABASE_PROVIDER=${dbConfig.provider} is not yet supported.`);
		default:
			dbConfig satisfies never;
	}
}

async function applySqlite(
	config: SqliteDatabaseConfig,
	migrations: MigrationMeta[],
	migrationsTable: string,
	logger: Logger
): Promise<void> {
	const { openSqliteClient } = await import("../../sqlite");
	const client = await openSqliteClient(config);
	const quotedMigrationsTable = `"${migrationsTable}"`;

	try {
		await client.execute(`
			CREATE TABLE IF NOT EXISTS ${quotedMigrationsTable} (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tag text NOT NULL UNIQUE,
				hash text NOT NULL,
				created_at integer NOT NULL
			)
		`);
		const migrationsDatabase: MigrationsDatabase = { provider: "sqlite", client };
		if ((await readMigrationsTableState(migrationsDatabase, migrationsTable)) === "untagged") {
			await addTagColumnToSqliteMigrationsTable(client, migrationsTable, migrations);
		}

		const appliedMigrations = await readAppliedMigrations(migrationsDatabase, migrationsTable);
		assertAppliedMigrationsUnchanged(appliedMigrations, migrations);
		const appliedTags = new Set(appliedMigrations.map((appliedMigration) => appliedMigration.tag));

		for (const migration of migrations) {
			if (appliedTags.has(migration.tag)) {
				continue;
			}

			logger.info(`Applying migration ${migration.tag}`);

			// Not a plain transaction: drizzle-kit changes a SQLite table by rebuilding it (create a
			// copy, move the rows, drop the original). While foreign keys are enforced, dropping the
			// original fails if rows in other tables still point at it. SQLite ignores switching
			// them off inside a transaction, so migrate() switches them off first, then runs the
			// statements in one.
			// The migration's row goes first: when another migrator has applied it since the read
			// above, the insert fails on the unique tag before any statement runs.
			try {
				await client.migrate([
					{
						sql: `INSERT INTO ${quotedMigrationsTable} (tag, hash, created_at) VALUES (?, ?, ?)`,
						args: [migration.tag, migration.hash, migration.folderMillis],
					},
					...migration.sql,
				]);
			} catch (error) {
				// The failed transaction left nothing behind, so a recorded tag means another migrator
				// applied this migration.
				if (await sqliteMigrationsTableHasTag(client, migrationsTable, migration.tag)) {
					continue;
				}
				throw error;
			}
		}
	} finally {
		client.close();
	}
}

// SQLite cannot add a NOT NULL column to a table, so the table is rebuilt with one.
async function addTagColumnToSqliteMigrationsTable(
	client: Client,
	migrationsTable: string,
	migrations: MigrationMeta[]
): Promise<void> {
	const quotedMigrationsTable = `"${migrationsTable}"`;
	const transaction = await client.transaction("write");
	try {
		const legacyRows = await transaction.execute(`SELECT hash, created_at FROM ${quotedMigrationsTable}`);
		const appliedMigrations = matchLegacyRowsToMigrations(
			legacyRows.rows.map((row) => ({ hash: String(row.hash), createdAtMs: Number(row.created_at) })),
			migrations,
			migrationsTable
		);

		const quotedRebuiltTable = `"${migrationsTable}_rebuilt"`;
		await transaction.execute(`
			CREATE TABLE ${quotedRebuiltTable} (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				tag text NOT NULL UNIQUE,
				hash text NOT NULL,
				created_at integer NOT NULL
			)
		`);
		for (const migration of appliedMigrations) {
			await transaction.execute({
				sql: `INSERT INTO ${quotedRebuiltTable} (tag, hash, created_at) VALUES (?, ?, ?)`,
				args: [migration.tag, migration.hash, migration.folderMillis],
			});
		}
		await transaction.execute(`DROP TABLE ${quotedMigrationsTable}`);
		await transaction.execute(`ALTER TABLE ${quotedRebuiltTable} RENAME TO ${quotedMigrationsTable}`);
		await transaction.commit();
	} finally {
		transaction.close();
	}
}

async function sqliteMigrationsTableHasTag(client: Client, migrationsTable: string, tag: string): Promise<boolean> {
	const taggedRows = await client.execute({ sql: `SELECT 1 FROM "${migrationsTable}" WHERE tag = ?`, args: [tag] });
	return taggedRows.rows.length > 0;
}

async function applyPg(
	config: PgDatabaseConfig,
	migrations: MigrationMeta[],
	migrationsTable: string,
	logger: Logger
): Promise<void> {
	const { sql } = await import("drizzle-orm");
	// Import the driver first: drizzle-orm/postgres-js imports it too, and would throw before the guard runs.
	const postgres = await importPostgres();
	const { drizzle } = await import("drizzle-orm/postgres-js");
	const client = postgres(config.url, {
		max: 1,
		ssl: config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : undefined,
		onnotice: (notice) => {
			if (notice.severity === "WARNING") {
				logger.warn(`Postgres warning: ${notice.message}`);
				return;
			}
			logger.debug(`Postgres notice: ${notice.message}`);
		},
	});
	const db = drizzle(client);
	const table = sql`drizzle.${sql.identifier(migrationsTable)}`;

	try {
		await db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
		await db.execute(sql`
			CREATE TABLE IF NOT EXISTS ${table} (
				id SERIAL PRIMARY KEY,
				tag text NOT NULL UNIQUE,
				hash text NOT NULL,
				created_at bigint NOT NULL
			)
		`);
		const migrationsDatabase: MigrationsDatabase = { provider: "pg", client };
		if ((await readMigrationsTableState(migrationsDatabase, migrationsTable)) === "untagged") {
			await addTagColumnToPgMigrationsTable(db, sql, migrationsTable, migrations);
		}

		const appliedMigrations = await readAppliedMigrations(migrationsDatabase, migrationsTable);
		assertAppliedMigrationsUnchanged(appliedMigrations, migrations);
		const appliedTags = new Set(appliedMigrations.map((appliedMigration) => appliedMigration.tag));

		for (const migration of migrations) {
			if (appliedTags.has(migration.tag)) {
				continue;
			}

			logger.info(`Applying migration ${migration.tag}`);

			// The migration's row goes first: when another migrator has applied it since the read
			// above, the insert fails on the unique tag before any statement runs.
			try {
				await db.transaction(async (tx) => {
					await tx.execute(
						sql`INSERT INTO ${table} (tag, hash, created_at) VALUES (${migration.tag}, ${migration.hash}, ${migration.folderMillis})`
					);
					for (const statement of migration.sql) {
						await tx.execute(sql.raw(statement));
					}
				});
			} catch (error) {
				// The failed transaction left nothing behind, so a recorded tag means another migrator
				// applied this migration.
				if (await pgMigrationsTableHasTag(db, sql, migrationsTable, migration.tag)) {
					continue;
				}
				throw error;
			}
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

async function addTagColumnToPgMigrationsTable(
	db: PostgresJsDatabase,
	sql: typeof import("drizzle-orm").sql,
	migrationsTable: string,
	migrations: MigrationMeta[]
): Promise<void> {
	const table = sql`drizzle.${sql.identifier(migrationsTable)}`;

	await db.transaction(async (tx) => {
		const legacyRows = await tx.execute<{ hash: string; createdAtMs: string }>(
			sql`SELECT hash, created_at AS "createdAtMs" FROM ${table}`
		);
		const appliedMigrations = matchLegacyRowsToMigrations(
			legacyRows.map((row) => ({ hash: row.hash, createdAtMs: Number(row.createdAtMs) })),
			migrations,
			migrationsTable
		);

		await tx.execute(sql`DELETE FROM ${table}`);
		await tx.execute(sql`ALTER TABLE ${table} ADD COLUMN tag text NOT NULL UNIQUE`);
		for (const migration of appliedMigrations) {
			await tx.execute(
				sql`INSERT INTO ${table} (tag, hash, created_at) VALUES (${migration.tag}, ${migration.hash}, ${migration.folderMillis})`
			);
		}
		await tx.execute(sql`ALTER TABLE ${table} ALTER COLUMN created_at SET NOT NULL`);
	});
}

async function pgMigrationsTableHasTag(
	db: PostgresJsDatabase,
	sql: typeof import("drizzle-orm").sql,
	migrationsTable: string,
	tag: string
): Promise<boolean> {
	const taggedRows = await db.execute(sql`SELECT 1 FROM drizzle.${sql.identifier(migrationsTable)} WHERE tag = ${tag}`);
	return taggedRows.length > 0;
}

interface LegacyMigrationRow {
	hash: string;
	createdAtMs: number;
}

// A legacy migrations table has no tag column: each row holds only a migration's hash and the
// creation time from its journal entry. A row is matched to the migration with the same pair, and
// several rows for one migration count as one.
function matchLegacyRowsToMigrations(
	legacyRows: LegacyMigrationRow[],
	migrations: MigrationMeta[],
	migrationsTable: string
): MigrationMeta[] {
	const migrationsByCreationAndHash = nestedMap(migrations, "folderMillis", "hash");

	const matchedMigrations = new Map<string, MigrationMeta>();
	for (const legacyRow of legacyRows) {
		const migrationsSharingLegacyRowCreationTime = migrationsByCreationAndHash.get(legacyRow.createdAtMs);
		const migration = migrationsSharingLegacyRowCreationTime?.get(legacyRow.hash);
		if (!migration) {
			const tagsSharingLegacyRowCreationTime = Array.from(
				migrationsSharingLegacyRowCreationTime?.values() ?? [],
				({ tag }) => tag
			);
			throw unmatchedLegacyRowError(legacyRow, tagsSharingLegacyRowCreationTime, migrationsTable);
		}
		matchedMigrations.set(migration.tag, migration);
	}
	return Array.from(matchedMigrations.values());
}

// A legacy row's creation time was copied from its migration's journal entry, so the row can only
// belong to a migration created at that time. When there are such migrations, one of them was
// applied with SQL that has since changed.
function unmatchedLegacyRowError(
	legacyRow: LegacyMigrationRow,
	tagsSharingLegacyRowCreationTime: string[],
	migrationsTable: string
): Error {
	if (tagsSharingLegacyRowCreationTime.length === 0) {
		return new Error(
			`${migrationsTable} has a migration created at ${legacyRow.createdAtMs}, which this version does not ship`
		);
	}
	return changedMigrationError(tagsSharingLegacyRowCreationTime);
}

function assertAppliedMigrationsUnchanged(appliedMigrations: AppliedMigration[], migrations: MigrationMeta[]): void {
	const migrationsByTag = new Map(migrations.map((migration) => [migration.tag, migration]));
	for (const appliedMigration of appliedMigrations) {
		const migration = migrationsByTag.get(appliedMigration.tag);
		if (migration && migration.hash !== appliedMigration.hash) {
			throw changedMigrationError([migration.tag]);
		}
	}
}

function changedMigrationError(tags: string[]): Error {
	return new Error(
		`migration ${tags.join(" or ")} has changed since it was applied to this database; a migration must not change once applied`
	);
}
