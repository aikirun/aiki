import { drizzle } from "drizzle-orm/libsql";

import type { SqliteClient } from "./client";
import * as schema from "./schema";

export function createSqliteHandle(client: SqliteClient) {
	return drizzle(client, { schema });
}

export type SqliteHandle = ReturnType<typeof createSqliteHandle>;
export type SqliteTransaction = Parameters<Parameters<SqliteHandle["transaction"]>[0]>[0];
export type SqliteDb = SqliteHandle | SqliteTransaction;
