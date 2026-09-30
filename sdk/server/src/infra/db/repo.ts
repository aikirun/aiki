import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";

import type { PgClient } from "./pg/provider";
import type { SqliteClient } from "./sqlite/client";
import type { Repositories } from "./types";

export async function createRepos(db: Database): Promise<Repositories> {
	switch (db.provider) {
		case "sqlite": {
			const { createSqliteRepos } = await import("./sqlite");
			const client = db[INTERNAL].client as SqliteClient;
			return createSqliteRepos(client);
		}
		case "pg": {
			const { createPgRepos } = await import("./pg");
			const client = db[INTERNAL].client as PgClient;
			return createPgRepos(client);
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
		default:
			return db.provider satisfies never;
	}
}
