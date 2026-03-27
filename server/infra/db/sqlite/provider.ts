import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import * as schema from "./schema";
import { Database } from "bun:sqlite";

const MIGRATIONS_FOLDER = join(import.meta.dir, "migration");

export interface SqliteDatabaseOptions {
	provider: "sqlite";
	path: string;
}

export function createSqliteDatabase(options: SqliteDatabaseOptions) {
	const raw = new Database(options.path);
	raw.exec("PRAGMA journal_mode = WAL");
	raw.exec("PRAGMA synchronous = FULL");
	raw.exec("PRAGMA foreign_keys = ON");
	raw.exec("PRAGMA busy_timeout = 5000");
	const conn = drizzle(raw, { schema });
	migrate(conn, { migrationsFolder: MIGRATIONS_FOLDER });
	return { raw, conn, close: () => raw.close() };
}

export type SqliteDatabaseConn = ReturnType<typeof createSqliteDatabase>["conn"];
export type SqliteTransaction = Parameters<Parameters<SqliteDatabaseConn["transaction"]>[0]>[0];
export type SqliteDb = SqliteDatabaseConn | SqliteTransaction;
