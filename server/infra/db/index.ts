/**
 * Database connection factory
 *
 * Updated to support SQLite alongside PostgreSQL.
 * Drop-in replacement for server/infra/db/index.ts
 */

import type { MySqlDatabaseOptions } from "./provider/mysql";
import { createPgDatabaseConn, type PgDatabaseConn, type PgDatabaseOptions } from "./provider/pg";
import { createSqliteDatabaseConn, type SqliteDatabaseConn, type SqliteDatabaseOptions } from "./provider/sqlite";

export type DatabaseOptions = PgDatabaseOptions | MySqlDatabaseOptions | SqliteDatabaseOptions;

// Union type for all supported database connections
export type DatabaseConn = PgDatabaseConn | SqliteDatabaseConn;

// Transaction type - works for both PG and SQLite
export type DbTransaction = Parameters<Parameters<DatabaseConn["transaction"]>[0]>[0];

export function createDatabaseConn(options: DatabaseOptions): DatabaseConn {
	switch (options.provider) {
		case "pg":
			return createPgDatabaseConn(options);
		case "sqlite":
			return createSqliteDatabaseConn(options);
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return options satisfies never;
	}
}

/**
 * Check if the database connection is SQLite
 * Useful for handling provider-specific behavior
 */
export function isSqliteConnection(db: DatabaseConn): db is SqliteDatabaseConn {
	// Type guard - can check via connection properties or store provider type
	return "dialect" in db && (db as unknown as { dialect?: { name?: string } }).dialect?.name === "sqlite";
}

/**
 * Check if the database connection is PostgreSQL
 */
export function isPgConnection(db: DatabaseConn): db is PgDatabaseConn {
	return "dialect" in db && (db as unknown as { dialect?: { name?: string } }).dialect?.name === "pg";
}
