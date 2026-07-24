import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";
import type { Repositories } from "./types";

export async function createRepos(db: Database): Promise<Repositories> {
	switch (db.provider) {
		case "pg": {
			const { createPgRepos } = await import("./pg");
			const client = db[INTERNAL].client as PgClient;
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
