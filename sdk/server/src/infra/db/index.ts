import type { Database } from "@aikirun/types/infra/db";
import { INTERNAL } from "@aikirun/types/symbols";
import { type } from "arktype";

import { createPgClient } from "./pg/provider";
import { createSqliteClient } from "./sqlite/provider";
import { type DatabaseConfig, databaseConfigSchema } from "../../config";

export function database(params: DatabaseConfig): Database {
	const validationResult = databaseConfigSchema(params);
	if (validationResult instanceof type.errors) {
		throw new Error(`Invalid database config: ${validationResult.summary}`);
	}

	switch (params.provider) {
		case "pg": {
			const client = createPgClient(params);
			return { provider: params.provider, [INTERNAL]: { client } };
		}
		case "sqlite": {
			const client = createSqliteClient(params);
			return { provider: params.provider, [INTERNAL]: { client } };
		}
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return params satisfies never;
	}
}
