import { expect, test } from "vitest";

import { migrateApply } from "./apply";
import { type Logger, noopLogger } from "../../../logger";
import { loadDatabaseConfig } from "../../config";
import { type Migrations, migrationSource } from "../source";
import { withMigrationsFixture } from "../testing/migrations-fixture";

const dbConfig = loadDatabaseConfig();

test.skipIf(dbConfig.provider !== "pg")("logs a notice a migration raises at debug level", () =>
	withMigrationsFixture(async (fixture) => {
		const noticeMigrations: Migrations = {
			journal: { entries: [{ tag: "0000_restock_widgets", when: 1_700_000_000_000 }] },
			files: { "0000_restock_widgets": "DO $$ BEGIN RAISE NOTICE 'restocking widgets'; END $$" },
		};
		const loggedMessages: string[] = [];
		const logger: Logger = {
			...noopLogger,
			debug: (message) => {
				loggedMessages.push(message);
			},
		};

		await migrateApply({
			source: migrationSource(noticeMigrations),
			migrationsTable: fixture.migrationsTable,
			db: dbConfig,
			logger,
		});

		// Postgres raises a notice of its own when the migrations schema already exists, so the
		// migration's notice may not be the only one.
		expect(loggedMessages).toEqual(expect.arrayContaining(["Postgres notice: restocking widgets"]));
	})
);

test.skipIf(dbConfig.provider !== "pg")("logs a warning a migration raises at warn level", () =>
	withMigrationsFixture(async (fixture) => {
		const warningMigrations: Migrations = {
			journal: { entries: [{ tag: "0000_warn_about_widgets", when: 1_700_000_000_000 }] },
			files: { "0000_warn_about_widgets": "DO $$ BEGIN RAISE WARNING 'widgets are running low'; END $$" },
		};
		const loggedMessages: string[] = [];
		const logger: Logger = {
			...noopLogger,
			warn: (message) => {
				loggedMessages.push(message);
			},
		};

		await migrateApply({
			source: migrationSource(warningMigrations),
			migrationsTable: fixture.migrationsTable,
			db: dbConfig,
			logger,
		});

		expect(loggedMessages).toEqual(["Postgres warning: widgets are running low"]);
	})
);
