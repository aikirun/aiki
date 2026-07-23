import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { TimerStreamCursor } from "../../../../../lib/timer-stream";

/**
 * Builds the WHERE clause that pages through a (dueAt, id)-ordered stream.
 *
 * The first two clauses are ordinary keyset paging: take every row that sorts after
 * the frontier (cursor.dueAt, cursor.id) — a later dueAt, or the same dueAt with a
 * larger id. The third clause takes rows that sort before the frontier (an earlier
 * dueAt) whose id is larger than any we have seen. Because ids are ULIDs and only grow
 * over time, a larger id means the row was inserted after the walk had already passed
 * its dueAt, so it would otherwise be missed until the next full pass.
 */
export function timerStreamCursorFilter(
	dueAtCol: PgColumn | SQL,
	idCol: PgColumn,
	cursor: TimerStreamCursor | undefined
): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	return or(
		sql`${dueAtCol} > ${cursor.dueAt}`,
		and(sql`${dueAtCol} = ${cursor.dueAt}`, gt(idCol, cursor.id)),
		and(sql`${dueAtCol} < ${cursor.dueAt}`, gt(idCol, cursor.maxSeenId))
	);
}
