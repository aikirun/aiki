import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import { type } from "arktype";
import { logLevels } from "server/logger";

export const redisConfigSchema = type({
	host: "string = 'localhost'",
	port: "string.integer.parse | number.integer > 0 = 6379",
	"password?": "string | undefined",
});

export const DATABASE_PROVIDERS = ["pg", "sqlite", "mysql"] as const;
export function isDatabaseProvider(provider: string): provider is DatabaseConfig["provider"] {
	for (const dbProvider of DATABASE_PROVIDERS) {
		if (provider === dbProvider) {
			return true;
		}
	}
	return false;
}

export const pgDatabaseConfigSchema = type({
	provider: "'pg'",
	url: "string",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	ssl: "boolean = false",
});

export const mysqlDatabaseConfigSchema = type({
	provider: "'mysql'",
	url: "string",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	ssl: "boolean = false",
});

export const sqliteDatabaseConfigSchema = type({
	provider: "'sqlite'",
	path: "string = ':memory:'",
});

export const databaseConfigSchema = pgDatabaseConfigSchema.or(mysqlDatabaseConfigSchema).or(sqliteDatabaseConfigSchema);

const coerceBool = type("'true' | 'false' | '1' | '0'").pipe((v) => v === "true" || v === "1");

export const configSchema = type({
	port: "string.integer.parse | number.integer > 0 = 9850",
	redis: redisConfigSchema,
	database: databaseConfigSchema,
	logLevel: type.enumerated(...logLevels).default("info"),
	prettyLogs: type("boolean").or(coerceBool).default(false),
});

export type RedisConfig = typeof redisConfigSchema.infer;

export type PgDatabaseConfig = typeof pgDatabaseConfigSchema.infer;
export type MysqlDatabaseConfig = typeof mysqlDatabaseConfigSchema.infer;
export type SqliteDatabaseConfig = typeof sqliteDatabaseConfigSchema.infer;
export type DatabaseConfig = typeof databaseConfigSchema.infer;

export type Config = typeof configSchema.infer;

type _DbOptionsSatisfiesDbProviders = ExpectTrue<
	Equal<DatabaseConfig["provider"], (typeof DATABASE_PROVIDERS)[number]>
>;
