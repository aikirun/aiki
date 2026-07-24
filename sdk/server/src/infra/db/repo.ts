import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";
import type { Repositories } from "./types";

function extractDbClient(db: Database): unknown {
	const { client } = db[INTERNAL];
	if (client === undefined) {
		throw new Error("Database must be created via database().");
	}
	return client;
}

export async function createRepos(db: Database): Promise<Repositories> {
	switch (db.provider) {
		case "pg": {
			const { createPgRepos } = await import("./pg");
			const client = extractDbClient(db) as PgClient;
			return createPgRepos(client);
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
		// case "sqlite":
		// 	throw new Error("SQLite support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}
