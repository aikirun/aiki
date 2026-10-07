import type { AsyncRemoteCallback } from "drizzle-orm/sqlite-proxy";

import type { SqliteExecutor, SqliteValue } from "./client";

/**
 * Answers drizzle's sqlite-proxy driver from an executor.
 */
export function drizzleSqliteProxyCallback(executor: SqliteExecutor): AsyncRemoteCallback {
	return async (sql, params, method) => {
		const result = await executor.execute(sql, params);
		switch (method) {
			case "run":
				return { rows: [], rowsAffected: result.rowsAffected };
			case "get":
				// "get" asks for a single row. drizzle expects `rows` to be that row, or undefined when
				// the query found nothing. Its type for this callback says `rows` is always an array,
				// so the assertion is there to let the undefined through.
				return { rows: result.rows[0] as SqliteValue[] };
			case "all":
			case "values":
				return { rows: result.rows };
			default:
				return method satisfies never;
		}
	};
}
