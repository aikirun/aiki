import process from "node:process";
import { type } from "arktype";

import { DATABASE_PROVIDERS, type DatabaseProvider, isDatabaseProvider } from "./provider";
import { omitUndefined } from "../object";
import type { Equal, ExpectTrue } from "../testing/expect";

const pgDatabaseConfigSchema = type({
	provider: "'pg'",
	url: "string > 0",
	"maxConnections?": "string.integer.parse | number.integer > 0",
	"caCert?": "string > 0",
});

const sqliteDatabaseConfigSchema = type({
	provider: "'sqlite'",
	path: "string > 0",
});

// const mysqlDatabaseConfigSchema = type({
// 	provider: "'mysql'",
// 	url: "string > 0",
// 	"maxConnections?": "string.integer.parse | number.integer > 0",
// 	"caCert?": "string > 0",
// });

const databaseConfigSchema = pgDatabaseConfigSchema.or(sqliteDatabaseConfigSchema) /*.or(mysqlDatabaseConfigSchema)*/;

export type PgDatabaseConfig = typeof pgDatabaseConfigSchema.infer;
export type SqliteDatabaseConfig = typeof sqliteDatabaseConfigSchema.infer;
// export type MysqlDatabaseConfig = typeof mysqlDatabaseConfigSchema.infer;
export type DatabaseConfig = typeof databaseConfigSchema.infer;

type _DbOptionsSatisfiesDbProviders = ExpectTrue<Equal<DatabaseConfig["provider"], DatabaseProvider>>;

const DATABASE_CONFIG_ENV_VARS: Record<string, string> = {
	url: "DATABASE_URL",
	maxConnections: "DATABASE_MAX_CONNECTIONS",
	caCert: "DATABASE_CA_CERT",
	path: "DATABASE_PATH",
} satisfies Record<
	Exclude<keyof PgDatabaseConfig | keyof SqliteDatabaseConfig /*| keyof MysqlDatabaseConfig*/, "provider">,
	string
>;

export function loadDatabaseProvider(): DatabaseProvider {
	const provider = process.env.DATABASE_PROVIDER;
	if (!provider) {
		throw new Error(`DATABASE_PROVIDER is required. Set it to one of: ${DATABASE_PROVIDERS.join(", ")}`);
	}
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
				return { provider, path: process.env.DATABASE_PATH || undefined };
			case "pg":
				// case "mysql":
				return {
					provider,
					url: process.env.DATABASE_URL,
					maxConnections: process.env.DATABASE_MAX_CONNECTIONS || undefined,
					caCert: process.env.DATABASE_CA_CERT || undefined,
				};
			default:
				return provider satisfies never;
		}
	})();

	const result = databaseConfigSchema(omitUndefined(raw));
	if (result instanceof type.errors) {
		const problems = result.map((error) => {
			const key = error.path[0];
			const envVar = typeof key === "string" ? DATABASE_CONFIG_ENV_VARS[key] : undefined;
			return envVar ? `${envVar} ${error.problem}` : error.message;
		});
		throw new Error(`Invalid database config: ${problems.join("; ")}`);
	}

	return result;
}
