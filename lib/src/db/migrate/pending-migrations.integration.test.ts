import { describe, expect, test } from "vitest";

import { migrateApply } from "./commands/apply";
import type { MigrationsDatabase } from "./migrations-table";
import { type ReportPendingMigrationsParams, reportPendingMigrations } from "./pending-migrations";
import { migrationSource } from "./source";
import {
	createLegacyMigrationsTable,
	type MigrationsFixture,
	withMigrationsFixture,
} from "./testing/migrations-fixture";
import type { Logger } from "../../logger";
import { noopLogger } from "../../logger";
import { loadDatabaseConfig } from "../config";

const dbConfig = loadDatabaseConfig();

describe("reportPendingMigrations", () => {
	test("reports that the database has none of the migrations when it has no migrations table", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await reportPendingMigrations(fixture.reportParams);

			expect(fixture.loggedEntries).toEqual([
				{
					level: "error",
					message: "The database has none of widget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));

	test("reports a legacy migrations table as predating this version", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await createLegacyMigrationsTable(fixture.migrationsTable);

			await reportPendingMigrations(fixture.reportParams);

			expect(fixture.loggedEntries).toEqual([
				{
					level: "warn",
					message: "The database's widget-app migrations predate this version. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));

	test("reports the migrations the database has not applied", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await migrateApply({
				source: migrationSource(fixture.firstMigrationOnly),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			await reportPendingMigrations(fixture.reportParams);

			expect(fixture.loggedEntries).toEqual([
				{
					level: "warn",
					message:
						"The database is missing 1 of widget-app's migrations: 0001_insert_widget. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));

	test("reports nothing when the database has applied every migration", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await migrateApply({
				source: migrationSource(fixture.migrations),
				migrationsTable: fixture.migrationsTable,
				db: dbConfig,
			});

			await reportPendingMigrations(fixture.reportParams);

			expect(fixture.loggedEntries).toEqual([]);
		}));

	test("warns once that it could not check the migrations when the database cannot be read", () =>
		withPendingMigrationsFixture(async (fixture) => {
			const closedDb = await openMigrationsDatabase();
			await closeMigrationsDatabase(closedDb);

			await Promise.all([
				reportPendingMigrations({ ...fixture.reportParams, db: closedDb }),
				reportPendingMigrations({ ...fixture.reportParams, db: closedDb }),
			]);

			expect(fixture.loggedEntries).toEqual([
				{
					level: "warn",
					message: "Couldn't check widget-app's migrations",
					metadata: { err: expect.any(Error) },
				},
			]);
		}));

	test("reports a migrations table once, however many times it is asked", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await Promise.all([reportPendingMigrations(fixture.reportParams), reportPendingMigrations(fixture.reportParams)]);
			await reportPendingMigrations(fixture.reportParams);

			expect(fixture.loggedEntries).toEqual([
				{
					level: "error",
					message: "The database has none of widget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));

	test("reports each migrations table of a database on its own", () =>
		withPendingMigrationsFixture(async (fixture) => {
			await reportPendingMigrations(fixture.reportParams);
			await reportPendingMigrations({
				...fixture.reportParams,
				migrationsTable: `${fixture.migrationsTable}_gadget`,
				name: "gadget-app",
			});

			expect(fixture.loggedEntries).toEqual([
				{
					level: "error",
					message: "The database has none of widget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
				{
					level: "error",
					message: "The database has none of gadget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));

	test("reports a migrations table on its own for each client of a database", () =>
		withPendingMigrationsFixture(async (fixture) => {
			const otherDb = await openMigrationsDatabase();
			try {
				await reportPendingMigrations(fixture.reportParams);
				await reportPendingMigrations({ ...fixture.reportParams, db: otherDb });
			} finally {
				await closeMigrationsDatabase(otherDb);
			}

			expect(fixture.loggedEntries).toEqual([
				{
					level: "error",
					message: "The database has none of widget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
				{
					level: "error",
					message: "The database has none of widget-app's migrations. Apply them: https://example.com/migrate",
					metadata: undefined,
				},
			]);
		}));
});

interface LoggedEntry {
	level: "warn" | "error";
	message: string;
	metadata: Record<string, unknown> | undefined;
}

interface PendingMigrationsFixture extends MigrationsFixture {
	loggedEntries: LoggedEntry[];
	reportParams: ReportPendingMigrationsParams;
}

// Adds a database connection of the test's own to the migrations fixture, closed once the test
// finishes.
async function withPendingMigrationsFixture(fn: (fixture: PendingMigrationsFixture) => Promise<void>): Promise<void> {
	await withMigrationsFixture(async (migrationsFixture) => {
		const loggedEntries: LoggedEntry[] = [];
		const db = await openMigrationsDatabase();
		try {
			await fn({
				...migrationsFixture,
				loggedEntries,
				reportParams: {
					db,
					name: "widget-app",
					docsUrl: "https://example.com/migrate",
					migrationsTable: migrationsFixture.migrationsTable,
					journal: migrationsFixture.migrations.journal,
					logger: createLogRecordingLogger(loggedEntries),
				},
			});
		} finally {
			await closeMigrationsDatabase(db);
		}
	});
}

function createLogRecordingLogger(loggedEntries: LoggedEntry[]): Logger {
	const logger: Logger = {
		...noopLogger,
		warn: (message, metadata) => {
			loggedEntries.push({ level: "warn", message, metadata });
		},
		error: (message, metadata) => {
			loggedEntries.push({ level: "error", message, metadata });
		},
		child: () => logger,
	};
	return logger;
}

async function openMigrationsDatabase(): Promise<MigrationsDatabase> {
	switch (dbConfig.provider) {
		case "sqlite": {
			const { openSqliteClient } = await import("../sqlite");
			return { provider: "sqlite", client: await openSqliteClient(dbConfig) };
		}
		case "pg": {
			const { default: postgres } = await import("postgres");
			return { provider: "pg", client: postgres(dbConfig.url, { max: 1, onnotice: () => {} }) };
		}
		default:
			return dbConfig satisfies never;
	}
}

async function closeMigrationsDatabase(db: MigrationsDatabase): Promise<void> {
	switch (db.provider) {
		case "sqlite":
			db.client.close();
			return;
		case "pg":
			await db.client.end();
			return;
		default:
			db satisfies never;
	}
}
