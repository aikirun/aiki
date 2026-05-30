import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { TimerStreamCursor } from "../../../../../lib/timer-stream";

export function timerStreamCursorFilter(
	dueAtCol: SQLiteColumn | SQL,
	idCol: SQLiteColumn,
	cursor: TimerStreamCursor | undefined
): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	// Timestamps are stored as ISO-8601 text; bun:sqlite cannot bind a Date in raw SQL,
	// and ISO-8601 UTC sorts lexicographically the same as chronologically.
	const dueAt = cursor.dueAt.toISOString();
	return or(
		sql`${dueAtCol} > ${dueAt}`,
		and(sql`${dueAtCol} = ${dueAt}`, gt(idCol, cursor.id)),
		and(sql`${dueAtCol} < ${dueAt}`, gt(idCol, cursor.maxId))
	);
}
