import { and, gt, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import type { RankStreamCursor } from "../../../../../daemons/lib/rank-stream";

export function rankStreamCursorFilter(
	rankCol: PgColumn,
	idCol: PgColumn,
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
