import { fireAndForget } from "@aikirun/lib/async";
import { reportPendingMigrations as _reportPendingMigrations, type MigrationsDatabase } from "@aikirun/lib/db/migrate";
import type { Logger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./infra/db/pg/provider";
import type { SqliteClient } from "./infra/db/sqlite/client";
import { MIGRATIONS_TABLE, migrationJournal } from "./migrate";

// Logs the migrations this version ships that the database has not applied. It reports once per
// database client and does not hold up the caller.
export function reportPendingMigrations(db: Database, logger: Logger): void {
	fireAndForget(
		_reportPendingMigrations({
			name: "aiki-server",
			docsUrl: "https://aiki.run/docs/getting-started/installation#apply-the-schema-migration",
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
