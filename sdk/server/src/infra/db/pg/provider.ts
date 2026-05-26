import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import type { PgDatabaseConfig } from "../../../config/";

export type PgClient = ReturnType<typeof postgres>;

export function createPgClient(params: PgDatabaseConfig): PgClient {
	return postgres(params.url, {
		max: params.maxConnections,
		ssl: params.ssl,
	});
}

export function createPgHandle(client: PgClient): PgHandle {
	return drizzle(client, { schema });
}

export type PgHandle = ReturnType<typeof drizzle<typeof schema>>;
export type PgTransaction = Parameters<Parameters<PgHandle["transaction"]>[0]>[0];
export type PgDb = PgHandle | PgTransaction;
