import { fireAndForget } from "@aikirun/lib/async";
import { reportPendingMigrations as _reportPendingMigrations, type MigrationsDatabase } from "@aikirun/lib/db/migrate";
import type { SqliteClient } from "@aikirun/lib/db/sqlite";
import type { Logger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./infra/db/pg/provider";
import { MIGRATIONS_TABLE, migrationJournal } from "./migrate";

// Logs the migrations this version ships that the database has not applied. It reports once per
// database client and does not hold up the caller.
export function reportPendingMigrations(db: Database, logger: Logger): void {
	fireAndForget(
		_reportPendingMigrations({
			name: "aiki-iam",
			docsUrl: "https://aiki.run/docs/guides/iam#2-apply-its-schema-migration",
			migrationsTable: MIGRATIONS_TABLE,
			journal: migrationJournal(db.provider),
			db: toMigrationsDatabase(db),
			logger,
		}),
		(err) => logger.warn("Reporting pending migrations failed", { err })
	);
}

function toMigrationsDatabase(db: Database): MigrationsDatabase {
	switch (db.provider) {
		case "sqlite":
			return { provider: "sqlite", client: db[INTERNAL].client as SqliteClient };
		case "pg":
			return { provider: "pg", client: db[INTERNAL].client as PgClient };
		default:
			return db.provider satisfies never;
	}
}
