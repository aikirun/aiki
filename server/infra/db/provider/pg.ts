import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../schema/pg";

export interface PgDatabaseOptions {
	provider: "pg";
	url: string;
	maxConnections?: number;
	ssl?: boolean;
}

export function createPgDatabaseConn(options: PgDatabaseOptions) {
	const client = postgres(options.url, {
		max: options.maxConnections ?? 10,
		ssl: options.ssl ? "require" : undefined,
	});

	return drizzle(client, { schema });
}

export type PgDatabaseConn = ReturnType<typeof createPgDatabaseConn>;
