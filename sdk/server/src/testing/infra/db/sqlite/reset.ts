import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";

import type { SqliteClient } from "../../../../infra/db/sqlite/client";
import * as schema from "../../../../infra/db/sqlite/schema";

// The migrations bookkeeping table lives outside the schema, so it is left untouched.
// Foreign keys are checked at commit, when every table is empty, so the delete order does not matter.
const resetStatements = [
	"PRAGMA defer_foreign_keys = ON",
	...(Object.values(schema) as unknown[])
		.filter((value): value is SQLiteTable => is(value, SQLiteTable))
		.map((table) => `DELETE FROM "${getTableName(table)}"`),
];

export async function deleteSqliteRows(db: Database): Promise<void> {
	const client = db[INTERNAL].client as SqliteClient;
	await client.batch(resetStatements, "write");
}
