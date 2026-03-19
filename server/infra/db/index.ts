import { createPgRepositories } from "./pg";
import { createPgDatabaseConn, type PgDatabaseOptions } from "./pg/provider";
import { betterAuthSchema as pgBetterAuthSchema } from "./pg/schema";

export type { Repositories } from "./types";
export * from "./types";

export type DatabaseOptions =
	| PgDatabaseOptions
	| { provider: "mysql"; url: string; maxConnections?: number; ssl?: boolean }
	| { provider: "sqlite"; path: string };

export function createDatabase(options: DatabaseOptions) {
	switch (options.provider) {
		case "pg": {
			const conn = createPgDatabaseConn(options);
			return {
				conn,
				repos: createPgRepositories(conn),
				betterAuthSchema: pgBetterAuthSchema,
			};
		}
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return options satisfies never;
	}
}
