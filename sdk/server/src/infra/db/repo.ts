import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import { createPgRepositories } from "./pg";
import type { PgDatabaseConn } from "./pg/provider";
import type { Repositories } from "./types";

export function extractDatabaseConn(database: Database): unknown {
	const internal = database[INTERNAL];
	if (!internal || internal.conn === undefined) {
		throw new Error("Database must be created via database().");
	}
	return internal.conn;
}

export function createRepos(database: Database): Repositories {
	switch (database.provider) {
		case "pg":
			return createPgRepositories(extractDatabaseConn(database) as PgDatabaseConn);
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		default:
			return database.provider satisfies never;
	}
}
