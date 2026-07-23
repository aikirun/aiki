import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { KeysetStreamCursor } from "../../../../../lib/keyset-stream";

/**
 * Builds the WHERE clause that pages through an (order, id)-ordered stream, where
 * `order` is any sortable column — a priority rank, a due timestamp, and so on.
 *
 * The first two clauses are ordinary keyset paging: take every row that sorts after
 * the frontier (cursor.order, cursor.id) — a larger order value, or the same order with
 * a larger id. The third clause takes rows that sort before the frontier (a smaller
 * order value) whose id is larger than any we have seen. Because ids are ULIDs and only
 * grow over time, a larger id means the row was inserted after the walk had already
 * passed its order, so it would otherwise be missed until the next full pass.
 */
export function keysetStreamCursorFilter(
	orderCol: PgColumn | SQL,
	idCol: PgColumn,
	cursor: KeysetStreamCursor | undefined
): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	return or(
		sql`${orderCol} > ${cursor.order}`,
		and(sql`${orderCol} = ${cursor.order}`, gt(idCol, cursor.id)),
		and(sql`${orderCol} < ${cursor.order}`, gt(idCol, cursor.maxSeenId))
	);
}
