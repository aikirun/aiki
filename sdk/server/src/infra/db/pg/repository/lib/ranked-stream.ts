import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { RankedStreamCursor } from "../../../../../lib/ranked-stream";

/**
 * Builds the WHERE clause that pages through a (rank, id)-ordered stream.
 *
 * The first two clauses are ordinary keyset paging: take every row that sorts after
 * the frontier (cursor.rank, cursor.id) — a larger rank value, or the same rank with
 * a larger id. The third clause takes rows that sort before the frontier (a smaller
 * rank value) whose id is larger than any we have seen. Because ids are ULIDs and only
 * grow over time, a larger id means the row was inserted after the walk had already
 * passed its rank, so it would otherwise be missed until the next full pass.
 */
export function rankedStreamCursorFilter(
	rankCol: PgColumn,
	idCol: PgColumn,
	cursor: RankedStreamCursor | undefined
): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	return or(
		sql`${rankCol} > ${cursor.rank}`,
		and(sql`${rankCol} = ${cursor.rank}`, gt(idCol, cursor.id)),
		and(sql`${rankCol} < ${cursor.rank}`, gt(idCol, cursor.maxSeenId))
	);
}
