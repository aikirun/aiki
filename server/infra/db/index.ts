import type { MySqlDatabaseOptions } from "./providers/mysql";
import { createPgDatabase, type PgDatabase, type PgDatabaseOptions } from "./providers/pg";
import type { SqliteDatabaseOptions } from "./providers/sqlite";

export type DatabaseOptions = PgDatabaseOptions | MySqlDatabaseOptions | SqliteDatabaseOptions;

export function createDatabase(options: DatabaseOptions) {
	switch (options.provider) {
		case "pg":
			return createPgDatabase(options);
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			options satisfies never;
	}
}

export type Database = PgDatabase;
