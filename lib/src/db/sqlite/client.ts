export type SqliteValue = null | number | bigint | string | Uint8Array;
export type SqliteParam = SqliteValue | boolean;

export interface SqliteResult {
	columns: string[];
	// One array per row, its values in column order.
	rows: SqliteValue[][];
	// Rows changed by a statement that returns none.
	rowsAffected: number;
}

export interface SqliteExecutor {
	// Runs one statement.
	execute(sql: string, params?: readonly SqliteParam[]): Promise<SqliteResult>;
}

// commit and rollback each end the transaction. A commit that fails undoes the transaction's
// writes before it throws, so the connection is never left inside it. Rolling back after the
// transaction has ended does nothing.
export interface SqliteTransaction extends SqliteExecutor {
	// Runs every statement in the text.
	executeScript(sql: string): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

export interface SqliteClient extends SqliteExecutor {
	transaction(): Promise<SqliteTransaction>;
	close(): void;
}
