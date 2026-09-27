import { loadDatabaseConfig } from "@aikirun/lib/db";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";

import * as schema from "./schema";
import { expect, test } from "bun:test";

const UPDATED_AT_TRIGGER_FUNCTION = "iam_set_updated_at_column";

const tableNamesWithUpdatedAt = (Object.values(schema) as unknown[])
	.filter((value): value is PgTable => is(value, PgTable))
	.map((table) => getTableConfig(table))
	.filter((table) => table.columns.some((column) => column.name === "updated_at"))
	.map((table) => table.name)
	.sort();

test("every table declaring updated_at carries the trigger that maintains it", async () => {
	const client = postgres(loadDatabaseConfig().url, { max: 1 });
	try {
		// tgtype is a bitmask: 2 marks a BEFORE trigger, 16 marks one that fires on UPDATE.
		const rows = await client<{ tableName: string }[]>`
			SELECT triggered_table.relname AS "tableName"
			FROM pg_trigger AS updated_at_trigger
			JOIN pg_class AS triggered_table ON triggered_table.oid = updated_at_trigger.tgrelid
			JOIN pg_proc AS trigger_function ON trigger_function.oid = updated_at_trigger.tgfoid
			WHERE trigger_function.proname = ${UPDATED_AT_TRIGGER_FUNCTION}
				AND NOT updated_at_trigger.tgisinternal
				AND (updated_at_trigger.tgtype & 2) <> 0
				AND (updated_at_trigger.tgtype & 16) <> 0
			ORDER BY triggered_table.relname
		`;

		expect(rows.map((row) => row.tableName)).toEqual(tableNamesWithUpdatedAt);
	} finally {
		await client.end();
	}
});
