/**
 * SQLite database provider for Aiki
 *
 * This implements the SQLite provider using better-sqlite3 (or Bun's native SQLite).
 * It follows the same patterns as the PostgreSQL provider for consistency.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "../schema/sqlite";

export interface SqliteDatabaseOptions {
	provider: "sqlite";
	path: string;
	/**
	 * Enable WAL mode for better concurrent read performance.
	 * Recommended for production use. Default: true
	 */
	walMode?: boolean;
	/**
	 * Busy timeout in milliseconds. Default: 5000 (5 seconds)
	 */
	busyTimeout?: number;
}

export function createSqliteDatabaseConn(options: SqliteDatabaseOptions) {
	const sqlite = new Database(options.path);

	// Enable foreign key constraints (off by default in SQLite)
	sqlite.pragma("foreign_keys = ON");

	// Enable WAL mode for better concurrent read performance
	if (options.walMode !== false) {
		sqlite.pragma("journal_mode = WAL");
	}

	// Set busy timeout for lock contention
	sqlite.pragma(`busy_timeout = ${options.busyTimeout ?? 5000}`);

	// Optimize for performance
	sqlite.pragma("synchronous = NORMAL");
	sqlite.pragma("cache_size = -64000"); // 64MB cache

	return drizzle(sqlite, { schema });
}

export type SqliteDatabaseConn = ReturnType<typeof createSqliteDatabaseConn>;

/**
 * Alternative implementation using Bun's native SQLite
 * Uncomment if using Bun runtime
 */
/*
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";

export function createSqliteDatabaseConnBun(options: SqliteDatabaseOptions) {
	const sqlite = new Database(options.path);

	sqlite.exec("PRAGMA foreign_keys = ON");
	
	if (options.walMode !== false) {
		sqlite.exec("PRAGMA journal_mode = WAL");
	}

	sqlite.exec(`PRAGMA busy_timeout = ${options.busyTimeout ?? 5000}`);
	sqlite.exec("PRAGMA synchronous = NORMAL");
	sqlite.exec("PRAGMA cache_size = -64000");

	return drizzle(sqlite, { schema });
}
*/
