import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { type SQL, sql } from "drizzle-orm";

/**
 * A `VALUES` list usable as a table in FROM or EXISTS, with named columns.
 * SQLite names a VALUES list's columns `column1`, `column2`, … and a table alias cannot rename
 * them, so the rows are wrapped in a SELECT that does.
 *
 * @example
 * valuesTable("v", ["id", "revision"], asNonEmptyArray(runs.map((run) => sql`(${run.id}, ${run.revision})`)))
 */
export function valuesTable(alias: string, columns: NonEmptyArray<string>, rows: NonEmptyArray<SQL>): SQL {
	const selectList = columns.map((column, index) => `column${index + 1} AS ${column}`).join(", ");
	return sql`(SELECT ${sql.raw(selectList)} FROM (VALUES ${sql.join(rows, sql`, `)})) AS ${sql.raw(alias)}`;
}
