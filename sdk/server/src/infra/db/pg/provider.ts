import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";
import type { PgDatabaseConfig } from "../../../config/";

export function createPgDatabaseConn(params: PgDatabaseConfig) {
	const client = postgres(params.url, {
		max: params.maxConnections,
		ssl: params.ssl,
	});

	return drizzle(client, { schema });
}

export type PgDatabaseConn = ReturnType<typeof createPgDatabaseConn>;
export type PgTransaction = Parameters<Parameters<PgDatabaseConn["transaction"]>[0]>[0];
export type PgDb = PgDatabaseConn | PgTransaction;
