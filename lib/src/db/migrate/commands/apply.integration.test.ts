import { migrateApply } from "./apply";
import { describe, expect, test } from "bun:test";
import { sha256 } from "../../../crypto";
import { loadDatabaseConfig } from "../../config";
import { type Migrations, migrationSource } from "../source";

const dbConfig = loadDatabaseConfig();

describe("migrateApply", () => {
	test("applies each migration once, and nothing when run again", () =>
		withMigrationsFixture(async (fixture) => {
			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});
			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(await readMigrationsTable(fixture.migrationsTable)).toEqual([
				{ tag: "0000_create_widget", hash: sha256(fixture.createWidgetSql), createdAtMs: 1_700_000_000_000 },
				{ tag: "0001_insert_widget", hash: sha256(fixture.insertWidgetSql), createdAtMs: 1_700_000_001_000 },
			]);
		}));

	test("adds tags to a legacy migrations table, keeping one row per migration", () =>
		withMigrationsFixture(async (fixture) => {
			await runSql(fixture.createWidgetSql);
			await runSql(legacyMigrationsTableSql(fixture.migrationsTable));
			// Two rows for one migration, as two migrators that both applied it would leave behind.
			await runSql(
				`INSERT INTO ${qualifiedMigrationsTable(fixture.migrationsTable)} (hash, created_at) VALUES ('${sha256(fixture.createWidgetSql)}', 1700000000000), ('${sha256(fixture.createWidgetSql)}', 1700000000000)`
			);

			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(await readMigrationsTable(fixture.migrationsTable)).toEqual([
				{ tag: "0000_create_widget", hash: sha256(fixture.createWidgetSql), createdAtMs: 1_700_000_000_000 },
				{ tag: "0001_insert_widget", hash: sha256(fixture.insertWidgetSql), createdAtMs: 1_700_000_001_000 },
			]);
		}));

	test("tells apart two migrations created at the same time when adding tags to a legacy migrations table", () =>
		withMigrationsFixture(async (fixture) => {
			const migrationsCreatedTogether: Migrations = {
				journal: {
					entries: [
						{ tag: "0000_create_widget", when: 1_700_000_000_000 },
						{ tag: "0001_insert_widget", when: 1_700_000_000_000 },
					],
				},
				files: fixture.migrations.files,
			};
			await runSql(fixture.createWidgetSql);
			await runSql(fixture.insertWidgetSql);
			await runSql(legacyMigrationsTableSql(fixture.migrationsTable));
			await runSql(
				`INSERT INTO ${qualifiedMigrationsTable(fixture.migrationsTable)} (hash, created_at) VALUES ('${sha256(fixture.createWidgetSql)}', 1700000000000), ('${sha256(fixture.insertWidgetSql)}', 1700000000000)`
			);

			await migrateApply({
				source: migrationSource(migrationsCreatedTogether),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(await readMigrationsTable(fixture.migrationsTable)).toEqual([
				{ tag: "0000_create_widget", hash: sha256(fixture.createWidgetSql), createdAtMs: 1_700_000_000_000 },
				{ tag: "0001_insert_widget", hash: sha256(fixture.insertWidgetSql), createdAtMs: 1_700_000_000_000 },
			]);
		}));

	test("refuses to add tags to a legacy migrations table when an applied migration has changed", () =>
		withMigrationsFixture(async (fixture) => {
			await runSql(legacyMigrationsTableSql(fixture.migrationsTable));
			await runSql(
				`INSERT INTO ${qualifiedMigrationsTable(fixture.migrationsTable)} (hash, created_at) VALUES ('${sha256("CREATE TABLE widget_before_edit (id text PRIMARY KEY)")}', 1700000000000)`
			);

			const applying = migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(applying).rejects.toThrow(
				"migration 0000_create_widget has changed since it was applied to this database; a migration must not change once applied"
			);
			await Promise.allSettled([applying]);
			expect(await runSql(`SELECT hash, created_at FROM ${qualifiedMigrationsTable(fixture.migrationsTable)}`)).toEqual(
				[
					{
						hash: sha256("CREATE TABLE widget_before_edit (id text PRIMARY KEY)"),
						created_at: fromDatabaseBigint(1_700_000_000_000),
					},
				]
			);
		}));

	test("refuses to add tags to a legacy migrations table with a migration this version does not ship", () =>
		withMigrationsFixture(async (fixture) => {
			await runSql(legacyMigrationsTableSql(fixture.migrationsTable));
			await runSql(
				`INSERT INTO ${qualifiedMigrationsTable(fixture.migrationsTable)} (hash, created_at) VALUES ('${sha256("CREATE TABLE gadget (id text PRIMARY KEY)")}', 1700000009000)`
			);

			const applying = migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(applying).rejects.toThrow(
				`${fixture.migrationsTable} has a migration created at 1700000009000, which this version does not ship`
			);
			await Promise.allSettled([applying]);
		}));

	test("refuses to apply anything when an applied migration has changed", () =>
		withMigrationsFixture(async (fixture) => {
			await migrateApply({
				source: migrationSource(fixture.firstMigrationOnly),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});
			const editedMigrations: Migrations = {
				journal: fixture.migrations.journal,
				files: { ...fixture.migrations.files, "0000_create_widget": `${fixture.createWidgetSql};\n` },
			};

			const applying = migrateApply({
				source: migrationSource(editedMigrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(applying).rejects.toThrow(
				"migration 0000_create_widget has changed since it was applied to this database; a migration must not change once applied"
			);
			await Promise.allSettled([applying]);
			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([]);
		}));

	test("skips a migration that another migrator applied after this one read the migrations table", () =>
		withMigrationsFixture(async (fixture) => {
			// The first migration also does what another migrator applying the second one does: runs its
			// statement and records its tag. So by the time this migrator reaches the second migration,
			// the tag it read as missing is recorded.
			const firstMigrationSql = [
				fixture.createWidgetSql,
				fixture.insertWidgetSql,
				`INSERT INTO ${qualifiedMigrationsTable(fixture.migrationsTable)} (tag, hash, created_at) VALUES ('0001_insert_widget', '${sha256(fixture.insertWidgetSql)}', 1700000001000)`,
			].join("\n--> statement-breakpoint\n");
			const migrationsAppliedMeanwhile: Migrations = {
				journal: fixture.migrations.journal,
				files: { "0000_create_widget": firstMigrationSql, "0001_insert_widget": fixture.insertWidgetSql },
			};

			await migrateApply({
				source: migrationSource(migrationsAppliedMeanwhile),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([{ id: "first-widget" }]);
			expect(await readMigrationsTable(fixture.migrationsTable)).toEqual([
				{ tag: "0000_create_widget", hash: sha256(firstMigrationSql), createdAtMs: 1_700_000_000_000 },
				{ tag: "0001_insert_widget", hash: sha256(fixture.insertWidgetSql), createdAtMs: 1_700_000_001_000 },
			]);
		}));

	test("stops at a migration whose own statements fail, without recording it", () =>
		withMigrationsFixture(async (fixture) => {
			const duplicateWidgetMigrations: Migrations = {
				journal: fixture.migrations.journal,
				files: {
					"0000_create_widget": fixture.createWidgetSql,
					"0001_insert_widget": `${fixture.insertWidgetSql}\n--> statement-breakpoint\n${fixture.insertWidgetSql}`,
				},
			};

			const applying = migrateApply({
				source: migrationSource(duplicateWidgetMigrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			expect(applying).rejects.toThrow();
			await Promise.allSettled([applying]);
			expect(await runSql(`SELECT id FROM ${fixture.widgetTable}`)).toEqual([]);
			expect(await readMigrationsTable(fixture.migrationsTable)).toEqual([
				{ tag: "0000_create_widget", hash: sha256(fixture.createWidgetSql), createdAtMs: 1_700_000_000_000 },
			]);
		}));
});

interface MigrationsFixture {
	widgetTable: string;
	migrationsTable: string;
	createWidgetSql: string;
	insertWidgetSql: string;
	migrations: Migrations;
	firstMigrationOnly: Migrations;
}

// Each test gets a widget table and a migrations table of its own, so tests share nothing with each
// other or with the migrated schema. Both tables are dropped once the test finishes.
async function withMigrationsFixture(fn: (fixture: MigrationsFixture) => Promise<void>): Promise<void> {
	const tableSuffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
	const widgetTable = `migrate_apply_widget_${tableSuffix}`;
	const migrationsTable = `migrate_apply_migrations_${tableSuffix}`;
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

async function readMigrationsTable(migrationsTable: string) {
	const migrationRows = await runSql(
		`SELECT tag, hash, created_at FROM ${qualifiedMigrationsTable(migrationsTable)} ORDER BY tag`
	);
	return migrationRows.map((migrationRow) => ({
		tag: migrationRow.tag,
		hash: migrationRow.hash,
		createdAtMs: Number(migrationRow.created_at),
	}));
}

function qualifiedMigrationsTable(migrationsTable: string): string {
	switch (dbConfig.provider) {
		case "sqlite":
			return `"${migrationsTable}"`;
		case "pg":
			return `drizzle."${migrationsTable}"`;
		default:
			return dbConfig satisfies never;
	}
}

// A migrations table in the legacy format, which has no tag column.
function legacyMigrationsTableSql(migrationsTable: string): string {
	switch (dbConfig.provider) {
		case "sqlite":
			return `CREATE TABLE "${migrationsTable}" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at integer)`;
		case "pg":
			return `CREATE TABLE drizzle."${migrationsTable}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
		default:
			return dbConfig satisfies never;
	}
}

// Postgres returns a bigint column as a string.
function fromDatabaseBigint(value: number): number | string {
	switch (dbConfig.provider) {
		case "sqlite":
			return value;
		case "pg":
			return String(value);
		default:
			return dbConfig satisfies never;
	}
}

async function runSql(statement: string): Promise<Record<string, unknown>[]> {
	switch (dbConfig.provider) {
		case "sqlite": {
			const { openSqliteClient } = await import("../../sqlite");
			const client = await openSqliteClient(dbConfig);
			try {
				const queryResult = await client.execute(statement);
				return queryResult.rows.map((row) =>
					Object.fromEntries(queryResult.columns.map((column) => [column, row[column]]))
				);
			} finally {
				client.close();
			}
		}
		case "pg": {
			const { default: postgres } = await import("postgres");
			const client = postgres(dbConfig.url, { max: 1, onnotice: () => {} });
			try {
				return [...(await client.unsafe(statement))];
			} finally {
				await client.end();
			}
		}
		default:
			return dbConfig satisfies never;
	}
}
