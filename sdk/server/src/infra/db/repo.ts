import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import { createPgRepos } from "./pg";
import { createPgHandle, type PgClient } from "./pg/provider";
import type { Repositories } from "./types";

function extractDbClient(db: Database): unknown {
	const internal = db[INTERNAL];
	if (!internal || internal.client === undefined) {
		throw new Error("Database must be created via database().");
	}
	return internal.client;
}

export function createRepos(db: Database): Repositories {
	switch (db.provider) {
		case "pg":
			return createPgRepos(createPgHandle(extractDbClient(db) as PgClient));
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}
