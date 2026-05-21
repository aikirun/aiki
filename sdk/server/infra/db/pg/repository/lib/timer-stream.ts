import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { TimerStreamCursor } from "../../../../../daemons/lib/timer-stream";

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
		and(sql`${dueAtCol} < ${cursor.dueAt}`, gt(idCol, cursor.maxId))
	);
}
