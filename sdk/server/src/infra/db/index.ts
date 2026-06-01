import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { type } from "arktype";

import { type DatabaseConfig, databaseConfigSchema } from "../../config";

export function database(config: DatabaseConfig): CreateDatabase {
	const validationResult = databaseConfigSchema(config);
	if (validationResult instanceof type.errors) {
		throw new Error(`Invalid database config: ${validationResult.summary}`);
	}

	let createDatabasePromise: Promise<Database> | undefined;
	return () => {
		if (!createDatabasePromise) {
			createDatabasePromise = createDatabase(config);
		}
		return createDatabasePromise;
	};
}

async function createDatabase(config: DatabaseConfig): Promise<Database> {
	switch (config.provider) {
		case "pg": {
			const { createPgClient } = await import("./pg/provider");
			return { provider: "pg", [INTERNAL]: { client: createPgClient(config) } };
		}
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return config satisfies never;
	}
}
