import type { SqliteClient } from "./client";
import type { SqliteDatabaseConfig } from "../config";

/**
 * Opens a client on the configured file.
 * The client has one connection and runs a statement the moment it is asked to, so a statement
 * issued while a transaction is open runs inside that transaction.
 */
export async function openSqliteClient(config: SqliteDatabaseConfig): Promise<SqliteClient> {
	const openNodeSqliteClient = await importNodeSqliteClient();
	return openNodeSqliteClient(config);
}

async function importNodeSqliteClient() {
	try {
		const { openNodeSqliteClient } = await import("./node-sqlite");
		return openNodeSqliteClient;
	} catch (cause) {
		throw new Error(
			"the sqlite provider requires node:sqlite, which ships with Node 22.16 and later and with Bun 1.4 and later",
			{ cause }
		);
	}
}
