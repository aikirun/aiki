import { loadDatabaseProvider } from "@aikirun/lib/db";

/**
 * Whether two write transactions can be open at once. SQLite has one writer at a time, so a
 * transaction there starts only once the open one has ended.
 */
export function allowsConcurrentWriteTransactions(): boolean {
	const provider = loadDatabaseProvider();
	switch (provider) {
		case "pg":
			return true;
		case "sqlite":
			return false;
		// case "mysql":
		// 	return true;
		default:
			return provider satisfies never;
	}
}
