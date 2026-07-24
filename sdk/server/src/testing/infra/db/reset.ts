import type { Database } from "@aikirun/types/infra/db";

/**
 * Empties every table so a test starts from a clean database.
 */
export async function resetDatabase(db: Database): Promise<void> {
	switch (db.provider) {
		case "pg": {
			const { truncatePgTables } = await import("./pg/reset");
			await truncatePgTables(db);
			return;
		}
		// case "mysql":
		// 	throw new Error("MySQL support not yet implemented");
		// case "sqlite":
		// 	throw new Error("SQLite support not yet implemented");
		default:
			db.provider satisfies never;
	}
}
