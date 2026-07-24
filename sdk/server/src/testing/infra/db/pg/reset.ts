import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import type { PgClient } from "../../../../infra/db/pg/provider";
import * as schema from "../../../../infra/db/pg/schema";

// Every table drizzle knows about; the migrations bookkeeping table lives outside the schema,
// so it is left untouched.
const truncateStatement = `TRUNCATE ${(Object.values(schema) as unknown[])
	.filter((value): value is PgTable => is(value, PgTable))
	.map((table) => `"${getTableName(table)}"`)
	.join(", ")} CASCADE`;

export async function truncatePgTables(db: Database): Promise<void> {
	const client = db[INTERNAL].client as PgClient;
	await client.unsafe(truncateStatement);
}
