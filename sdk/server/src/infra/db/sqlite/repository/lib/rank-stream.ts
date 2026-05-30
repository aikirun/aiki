import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { RankStreamCursor } from "../../../../../lib/rank-stream";

export function rankStreamCursorFilter(
	rankCol: SQLiteColumn,
	idCol: SQLiteColumn,
	cursor: RankStreamCursor | undefined
): SQL | undefined {
	if (!cursor) {
		return undefined;
	}
	return or(
		sql`${rankCol} > ${cursor.rank}`,
		and(sql`${rankCol} = ${cursor.rank}`, gt(idCol, cursor.id)),
		and(sql`${rankCol} < ${cursor.rank}`, gt(idCol, cursor.maxId))
	);
}
