import { drizzle } from "drizzle-orm/bun-sqlite";

import * as schema from "./schema";
import { Database } from "bun:sqlite";
import type { SqliteDatabaseConfig } from "../../../config";

export type SqliteClient = Database;

export function createSqliteClient(params: SqliteDatabaseConfig): SqliteClient {
	const client = new Database(params.path);
	client.exec("PRAGMA journal_mode = WAL");
	client.exec("PRAGMA synchronous = FULL");
	client.exec("PRAGMA foreign_keys = ON");
	client.exec("PRAGMA busy_timeout = 5000");
	return client;
}

export function createSqliteHandle(client: SqliteClient) {
	return drizzle(client, { schema });
}

export type SqliteHandle = ReturnType<typeof createSqliteHandle>;
export type SqliteTransaction = Parameters<Parameters<SqliteHandle["transaction"]>[0]>[0];
export type SqliteDb = SqliteHandle | SqliteTransaction;
