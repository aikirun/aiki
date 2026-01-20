import type { MySqlDatabaseOptions } from "./provider/mysql";
import { createPgDatabaseConn, type PgDatabaseConn, type PgDatabaseOptions } from "./provider/pg";
import type { SqliteDatabaseOptions } from "./provider/sqlite";

export type DatabaseOptions = PgDatabaseOptions | MySqlDatabaseOptions | SqliteDatabaseOptions;
export type DatabaseConn = PgDatabaseConn;

export function createDatabaseConn(options: DatabaseOptions): DatabaseConn {
	switch (options.provider) {
		case "pg":
			return createPgDatabaseConn(options);
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return options satisfies never;
	}
}
