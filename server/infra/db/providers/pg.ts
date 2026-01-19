import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../schema/pg";

export interface PgDatabaseOptions {
	provider: "pg";
	connectionString: string;
	maxConnections?: number;
	ssl?: boolean;
}

export function createPgDatabase(options: PgDatabaseOptions) {
	const client = postgres(options.connectionString, {
		max: options.maxConnections ?? 10,
		ssl: options.ssl ? "require" : undefined,
	});

	return drizzle(client, { schema });
}

export type PgDatabase = ReturnType<typeof createPgDatabase>;
