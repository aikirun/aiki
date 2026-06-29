import type { CreateDatabase, Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { type } from "arktype";

import { type DatabaseConfig, databaseConfigSchema, type PgDatabaseConfig } from "../../config";

export function database(config: DatabaseConfig): CreateDatabase {
	const validationResult = databaseConfigSchema(config);
	if (validationResult instanceof type.errors) {
		throw new Error(`Invalid database config: ${validationResult.summary}`);
	}

	if (config.provider !== "pg") {
		throw new Error(`${config.provider} support not yet implemented`);
	}

	let createDatabasePromise: Promise<Database> | undefined;
	return () => {
		if (!createDatabasePromise) {
			createDatabasePromise = createDatabase(config);
		}
		return createDatabasePromise;
	};
}

async function createDatabase(config: PgDatabaseConfig): Promise<Database> {
	const { createPgClient } = await import("./pg/provider");
	return { provider: "pg", [INTERNAL]: { client: createPgClient(config) } };
}
