import process from "node:process";
import { omitUndefined } from "@aikirun/lib/object";
import { type } from "arktype";

import { DATABASE_PROVIDERS, type DatabaseConfig, databaseConfigSchema, isDatabaseProvider } from "./schema";

export function loadDatabaseConfig(): DatabaseConfig {
	const loadEnv = () => {
		const provider = process.env.DATABASE_PROVIDER ?? "pg";
		if (!isDatabaseProvider(provider)) {
			throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Must be one of: ${DATABASE_PROVIDERS.join(", ")}`);
		}

		switch (provider) {
			case "sqlite":
				return { provider, path: process.env.DATABASE_PATH };
			case "pg":
			case "mysql":
				return {
					provider,
					url: process.env.DATABASE_URL,
					maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
					ssl: process.env.DATABASE_SSL,
				};
			default:
				provider satisfies never;
		}
	};

	const raw = loadEnv();
	const result = databaseConfigSchema(omitUndefined(raw ?? {}));
	if (result instanceof type.errors) {
		throw new Error(`Invalid database config: ${result.summary}`);
	}

	return result;
}
