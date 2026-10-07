import { drizzleSqliteProxyCallback, type SqliteExecutor } from "@aikirun/lib/db/sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";

export function createSqliteHandle(executor: SqliteExecutor): SqliteDb {
	return drizzle(drizzleSqliteProxyCallback(executor));
}

// The drizzle handle that the SQLite repositories query through.
//
// It is drizzle's handle with transaction() and batch() removed from its type, so that code which
// calls either of them does not compile:
//
// - transaction() would not keep other requests out of the transaction. Every request shares the
//   SQLite client's one connection, and the client runs their statements one at a time, in the
//   order they arrive. drizzle's transaction() runs BEGIN, then the transaction's own statements,
//   then COMMIT, and to the client each of those is just another statement. So a statement from
//   another request can arrive, and run, between BEGIN and COMMIT. It would then be part of this
//   transaction: committed with it, or rolled back with it.
// - batch() does not work on this handle at all: it needs a second function that this handle is
//   not given, and throws without it.
//
// To run statements in one transaction, use transaction() on the repositories that
// createSqliteRepos returns. It opens the transaction on the client itself, and the client makes
// every other statement wait until that transaction has ended.
export type SqliteDb = Omit<ReturnType<typeof drizzle>, "transaction" | "batch">;
