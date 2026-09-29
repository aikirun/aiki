import path from "node:path";
import { createMutex, type Mutex } from "@aikirun/lib/async";
import type { SqliteDatabaseConfig } from "@aikirun/lib/db";
import { openSqliteClient } from "@aikirun/lib/db/sqlite";
import type { Client, InArgs, InStatement, ResultSet, Transaction, TransactionMode } from "@libsql/client";

export type SqliteClient = Client;

/**
 * A libsql client that opens its file on first use and runs statements one at a time across the
 * process, holding the turn for a transaction's whole life.
 *
 * libsql runs SQLite on the calling thread, so a writer that finds the file locked waits inside
 * that call: the event loop stops, and the transaction holding the lock never gets to commit.
 * Statements queue on a mutex instead. There is one mutex per file, so everything holding this
 * client, and every other client opened on the same file, takes turns on it.
 *
 * A file that cannot be opened fails the query that tried, and the next query opens it again.
 */
export function createSqliteClient(config: SqliteDatabaseConfig): SqliteClient {
	const mutex = config.path === ":memory:" ? createMutex() : mutexForFile(config.path);
	let client: Client | undefined;
	let openClientPromise: Promise<Client> | undefined;

	const withClient = <T>(fn: (openedClient: Client) => Promise<T>): Promise<T> => {
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

	function execute(stmt: InStatement): Promise<ResultSet>;
	function execute(sql: string, args?: InArgs): Promise<ResultSet>;
	function execute(stmtOrSql: InStatement, args?: InArgs): Promise<ResultSet> {
		const stmt = typeof stmtOrSql === "string" && args !== undefined ? { sql: stmtOrSql, args } : stmtOrSql;
		return mutex.runExclusive(() => withClient((openedClient) => openedClient.execute(stmt)));
	}

	return {
		get closed() {
			return client?.closed ?? false;
		},
		protocol: "file",
		execute,
		batch: (stmts, mode) => mutex.runExclusive(() => withClient((openedClient) => openedClient.batch(stmts, mode))),
		migrate: (stmts) => mutex.runExclusive(() => withClient((openedClient) => openedClient.migrate(stmts))),
		executeMultiple: (sql) => mutex.runExclusive(() => withClient((openedClient) => openedClient.executeMultiple(sql))),
		async transaction(mode?: TransactionMode): Promise<Transaction> {
			const releaseMutex = await mutex.acquire();
			try {
				const transaction = await withClient((openedClient) => openedClient.transaction(mode));
				return createSqliteTransaction(transaction, releaseMutex);
			} catch (error) {
				releaseMutex();
				throw error;
			}
		},
		sync: () => withClient((openedClient) => openedClient.sync()),
		reconnect: () => client?.reconnect(),
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

// A libsql transaction that releases the mutex once it commits, rolls back or closes.
function createSqliteTransaction(transaction: Transaction, releaseMutex: () => void): Transaction {
	return {
		get closed() {
			return transaction.closed;
		},
		execute: (stmt) => transaction.execute(stmt),
		batch: (stmts) => transaction.batch(stmts),
		executeMultiple: (sql) => transaction.executeMultiple(sql),
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
		close() {
			try {
				transaction.close();
			} finally {
				releaseMutex();
			}
		},
	};
}
