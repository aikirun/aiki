import path from "node:path";
import { createMutex, type Mutex } from "@aikirun/lib/async";
import type { SqliteDatabaseConfig } from "@aikirun/lib/db";
import { openSqliteClient, type SqliteClient, type SqliteTransaction } from "@aikirun/lib/db/sqlite";

/**
 * A SQLite client that opens its file on first use and runs statements one at a time across the
 * process, holding the turn for a transaction's whole life.
 *
 * A client has one connection, so a statement that ran while a transaction was open would run
 * inside it. The connection also runs on the calling thread, so a writer that finds the file
 * locked waits inside that call: the event loop stops, and the transaction holding the lock never
 * gets to commit. Statements queue on a mutex instead. There is one mutex per file, so everything
 * holding this client, and every other client opened on the same file, takes turns on it.
 *
 * A file that cannot be opened fails the query that tried, and the next query opens it again.
 */
export function createSqliteClient(config: SqliteDatabaseConfig): SqliteClient {
	const mutex = config.path === ":memory:" ? createMutex() : mutexForFile(config.path);
	let client: SqliteClient | undefined;
	let openClientPromise: Promise<SqliteClient> | undefined;

	const withClient = <T>(fn: (openedClient: SqliteClient) => Promise<T>): Promise<T> => {
		if (client) {
			return fn(client);
		}
		return (async () => {
			openClientPromise ??= openSqliteClient(config);
			try {
				client = await openClientPromise;
			} catch (error) {
				openClientPromise = undefined;
				throw error;
			}
			return fn(client);
		})();
	};

	return {
		execute: (sql, params) => mutex.runExclusive(() => withClient((openedClient) => openedClient.execute(sql, params))),
		async transaction(): Promise<SqliteTransaction> {
			const releaseMutex = await mutex.acquire();
			try {
				const transaction = await withClient((openedClient) => openedClient.transaction());
				return createSqliteTransaction(transaction, releaseMutex);
			} catch (error) {
				releaseMutex();
				throw error;
			}
		},
		close: () => client?.close(),
	};
}

const mutexForFile = (() => {
	const mutexes = new Map<string, Mutex>();
	return (configPath: string): Mutex => {
		const filePath = path.resolve(configPath.startsWith("file:") ? configPath.slice("file:".length) : configPath);
		let mutex = mutexes.get(filePath);
		if (!mutex) {
			mutex = createMutex();
			mutexes.set(filePath, mutex);
		}
		return mutex;
	};
})();

// A transaction that releases the mutex once it commits or rolls back.
function createSqliteTransaction(transaction: SqliteTransaction, releaseMutex: () => void): SqliteTransaction {
	return {
		execute: (sql, params) => transaction.execute(sql, params),
		executeScript: (sql) => transaction.executeScript(sql),
		async commit() {
			try {
				await transaction.commit();
			} finally {
				releaseMutex();
			}
		},
		async rollback() {
			try {
				await transaction.rollback();
			} finally {
				releaseMutex();
			}
		},
	};
}
