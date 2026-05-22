import { type } from "arktype";

import { createPgRepositories } from "./pg";
import { createPgDatabaseConn } from "./pg/provider";
import { betterAuthSchema as pgBetterAuthSchema } from "./pg/schema";
import { type DatabaseConfig, databaseConfigSchema } from "../../config";

export function createDatabase(params: DatabaseConfig) {
	const validationResult = databaseConfigSchema(params);
	if (validationResult instanceof type.errors) {
		throw new Error(`Invalid database config: ${validationResult.summary}`);
	}

	switch (params.provider) {
		case "pg": {
			const conn = createPgDatabaseConn(params);
			return {
				conn,
				repos: createPgRepositories(conn),
				betterAuthSchema: pgBetterAuthSchema,
			};
		}
		case "sqlite":
			throw new Error("SQLite support not yet implemented");
		case "mysql":
			throw new Error("MySQL support not yet implemented");
		default:
			return params satisfies never;
	}
}
