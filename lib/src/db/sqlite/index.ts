import type { Client } from "@libsql/client";

import type { SqliteDatabaseConfig } from "../config";

// How long a connection waits for another connection's write lock before failing.
// The wait blocks the calling thread.
const BUSY_TIMEOUT_MS = 5_000;

/**
 * Opens a libsql client on the configured file.
 * libsql already opens every pooled connection with foreign keys on and synchronous FULL.
 * WAL is a property of the file, so setting it once covers every connection.
 */
export async function openSqliteClient(config: SqliteDatabaseConfig): Promise<Client> {
	const createClient = await importLibsql();
	const client = createClient({ url: toLibsqlUrl(config.path), timeout: BUSY_TIMEOUT_MS });
	try {
		await client.execute("PRAGMA journal_mode = WAL");
	} catch (error) {
		client.close();
		throw error;
	}
	return client;
}

function toLibsqlUrl(path: string): string {
	return path.startsWith("file:") || path === ":memory:" ? path : `file:${path}`;
}

async function importLibsql() {
	try {
		const { createClient } = await import("@libsql/client");
		return createClient;
	} catch {
		throw new Error("the sqlite provider requires the libsql driver, install it with: npm install @libsql/client");
	}
}
