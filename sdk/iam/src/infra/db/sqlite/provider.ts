import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";
import type { Database } from "bun:sqlite";

export type SqliteClient = Database;

export function createSqliteHandle(client: SqliteClient) {
	return drizzle(client, { schema });
}

export type SqliteHandle = ReturnType<typeof createSqliteHandle>;
export type SqliteTransaction = Parameters<Parameters<SqliteHandle["transaction"]>[0]>[0];
export type SqliteDb = SqliteHandle | SqliteTransaction;
