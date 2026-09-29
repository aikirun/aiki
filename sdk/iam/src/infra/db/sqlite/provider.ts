import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export type SqliteClient = Client;

export function createSqliteHandle(client: SqliteClient): SqliteHandle {
	return drizzle(client, { schema });
}

export type SqliteHandle = ReturnType<typeof drizzle<typeof schema>>;
export type SqliteTransaction = Parameters<Parameters<SqliteHandle["transaction"]>[0]>[0];
export type SqliteDb = SqliteHandle | SqliteTransaction;
