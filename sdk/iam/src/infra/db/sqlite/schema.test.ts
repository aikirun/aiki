import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { expect, test } from "vitest";

import * as schema from "./schema";

const tables = (Object.values(schema) as unknown[])
	.filter((value): value is SQLiteTable => is(value, SQLiteTable))
	.map((table) => getTableConfig(table));

test("every updated_at column has a value the update statement writes", () => {
	const updatedAtColumns = tables.flatMap((table) =>
		table.columns.filter((column) => column.name === "updated_at").map((column) => ({ table: table.name, column }))
	);

	expect(updatedAtColumns.length).toBeGreaterThan(0);
	expect(updatedAtColumns.filter(({ column }) => column.onUpdateFn === undefined).map(({ table }) => table)).toEqual(
		[]
	);
});
