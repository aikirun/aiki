import process from "node:process";
import { type } from "arktype";

import { DATABASE_PROVIDERS, type DatabaseProvider, isDatabaseProvider } from "./provider";
import { omitUndefined } from "../object";
import type { Equal, ExpectTrue } from "../testing/expect";

const pgDatabaseConfigSchema = type({
	provider: "'pg'",
	url: "string > 0",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	"caCert?": "string > 0",
});

const mysqlDatabaseConfigSchema = type({
	provider: "'mysql'",
	url: "string > 0",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	"caCert?": "string > 0",
});

const sqliteDatabaseConfigSchema = type({
	provider: "'sqlite'",
	path: "string > 0 = ':memory:'",
});

const databaseConfigSchema = pgDatabaseConfigSchema.or(mysqlDatabaseConfigSchema).or(sqliteDatabaseConfigSchema);

export type PgDatabaseConfig = typeof pgDatabaseConfigSchema.infer;
export type MysqlDatabaseConfig = typeof mysqlDatabaseConfigSchema.infer;
export type SqliteDatabaseConfig = typeof sqliteDatabaseConfigSchema.infer;
export type DatabaseConfig = typeof databaseConfigSchema.infer;

type _DbOptionsSatisfiesDbProviders = ExpectTrue<Equal<DatabaseConfig["provider"], DatabaseProvider>>;

export function loadDatabaseProvider(): DatabaseProvider {
	const provider = process.env.DATABASE_PROVIDER ?? "pg";
	if (!isDatabaseProvider(provider)) {
		throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Must be one of: ${DATABASE_PROVIDERS.join(", ")}`);
	}

	return provider;
}

export function loadDatabaseConfig(): DatabaseConfig {
	const provider = loadDatabaseProvider();

	const raw = (() => {
		switch (provider) {
			case "sqlite":
				return { provider, path: process.env.DATABASE_PATH };
			case "pg":
			case "mysql":
				return {
					provider,
					url: process.env.DATABASE_URL,
					maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
					caCert: process.env.DATABASE_CA_CERT || undefined,
				};
			default:
				return provider satisfies never;
		}
	})();

	const result = databaseConfigSchema(omitUndefined(raw));
	if (result instanceof type.errors) {
		throw new Error(`Invalid database config: ${result.summary}`);
	}

	return result;
}
