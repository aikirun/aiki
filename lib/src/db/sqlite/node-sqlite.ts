import { DatabaseSync, type SQLInputValue, StatementSync } from "node:sqlite";

import type { SqliteClient, SqliteParam, SqliteResult, SqliteTransaction, SqliteValue } from "./client";
import type { SqliteDatabaseConfig } from "../config";

// Rows as arrays and a connection's transaction state arrived in the same node:sqlite release, so
// this one check stands for both.
if (!("setReturnArrays" in StatementSync.prototype)) {
	throw new Error("this runtime's node:sqlite cannot return rows as arrays");
}

// How long a connection waits for another connection's write lock before failing.
// The wait blocks the calling thread.
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens the configured file on one node:sqlite connection.
 * WAL is a property of the file, so setting it once covers every connection.
 * Syncing and foreign keys are set rather than left to the SQLite build, because builds differ:
 * Apple's syncs a WAL file less often by default.
 */
export function openNodeSqliteClient(config: SqliteDatabaseConfig): SqliteClient {
	const database = new DatabaseSync(toFilePath(config.path));
	try {
		database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
		database.exec("PRAGMA journal_mode = WAL");
		database.exec("PRAGMA synchronous = FULL");
		database.exec("PRAGMA foreign_keys = ON");
	} catch (error) {
		database.close();
		throw error;
	}

	return {
		async execute(sql, params) {
			return executeStatement({ database, sql, sqlParams: params });
		},
		async transaction() {
			// BEGIN IMMEDIATE takes the database's write lock at once, so nothing the transaction
			// reads changes before it commits.
			database.exec("BEGIN IMMEDIATE");
			return createTransaction(database);
		},
		close() {
			if (database.isOpen) {
				database.close();
			}
		},
	};
}

function toFilePath(path: string): string {
	return path.startsWith("file:") ? path.slice("file:".length) : path;
}

function createTransaction(database: DatabaseSync): SqliteTransaction {
	let hasEnded = false;

	return {
		async execute(sql, params) {
			if (hasEnded) {
				throw new Error("the transaction has ended");
			}
			return executeStatement({ database, sql, sqlParams: params });
		},
		async executeScript(sql) {
			if (hasEnded) {
				throw new Error("the transaction has ended");
			}
			database.exec(sql);
		},
		async commit() {
			if (hasEnded) {
				throw new Error("the transaction has ended");
			}
			hasEnded = true;
			try {
				database.exec("COMMIT");
			} catch (error) {
				// A commit that fails leaves the transaction open on the connection.
				if (database.isTransaction) {
					database.exec("ROLLBACK");
				}
				throw error;
			}
		},
		async rollback() {
			if (hasEnded) {
				return;
			}
			hasEnded = true;
			// SQLite ends a transaction itself after some errors, a full disk for one.
			if (database.isTransaction) {
				database.exec("ROLLBACK");
			}
		},
	};
}

function executeStatement(params: {
	database: DatabaseSync;
	sql: string;
	sqlParams?: readonly SqliteParam[];
}): SqliteResult {
	const { database, sql, sqlParams = [] } = params;
	const statement = database.prepare(sql);
	// Preparing compiles the first statement and drops the rest without a word.
	if (sql.slice(statement.sourceSQL.length).trim() !== "") {
		throw new Error("execute takes one SQL statement, and this text holds more");
	}

	const boundParams = sqlParams.map(toBoundParam);
	const columns = statement.columns().map((column) => column.name);
	if (columns.length === 0) {
		const { changes } = statement.run(...boundParams);
		return { columns, rows: [], rowsAffected: Number(changes) };
	}

	statement.setReturnArrays(true);
	// The statement returns arrays from here on, which its type does not follow.
	const rows = statement.all(...boundParams) as unknown as SqliteValue[][];
	return { columns, rows, rowsAffected: 0 };
}

// node:sqlite runtimes disagree on booleans and undefined, and every one of them stores a Date as
// NULL, so what may be bound is settled here.
function toBoundParam(param: SqliteParam, index: number): SQLInputValue {
	if (typeof param === "boolean") {
		return param ? 1 : 0;
	}
	if (
		param === null ||
		typeof param === "number" ||
		typeof param === "bigint" ||
		typeof param === "string" ||
		param instanceof Uint8Array
	) {
		return param;
	}
	throw new TypeError(
		`SQL parameter ${index + 1} is ${Object.prototype.toString.call(param)}, which SQLite cannot store`
	);
}
