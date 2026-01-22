import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import { type } from "arktype";
import { logLevels } from "server/infra/logger";

const coerceBool = type("'true' | 'false' | '1' | '0'").pipe((v) => v === "true" || v === "1");

const uniqueCommaSeparatedToItems = type("string > 0").pipe((v) => [
	...new Set(
		v
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0)
	),
]);

export const redisConfigSchema = type({
	host: "string > 0 = 'localhost'",
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
	url: "string > 0",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	ssl: type("boolean").or(coerceBool).default(false),
});

export const mysqlDatabaseConfigSchema = type({
	provider: "'mysql'",
	url: "string > 0",
	maxConnections: "string.integer.parse | number.integer > 0 = 10",
	ssl: type("boolean").or(coerceBool).default(false),
});

export const sqliteDatabaseConfigSchema = type({
	provider: "'sqlite'",
	path: "string > 0 = ':memory:'",
});

export const databaseConfigSchema = pgDatabaseConfigSchema.or(mysqlDatabaseConfigSchema).or(sqliteDatabaseConfigSchema);

export const authConfigSchema = type({
	secret: "string > 0",
});

export const configSchema = type({
	port: "string.integer.parse | number.integer > 0 = 9850",
	baseURL: "string > 0",
	corsOrigins: uniqueCommaSeparatedToItems,
	redis: redisConfigSchema,
	database: databaseConfigSchema,
	auth: authConfigSchema,
	logLevel: type.enumerated(...logLevels).default("info"),
	prettyLogs: type("boolean").or(coerceBool).default(false),
});

export type RedisConfig = typeof redisConfigSchema.infer;
export type AuthConfig = typeof authConfigSchema.infer;

export type PgDatabaseConfig = typeof pgDatabaseConfigSchema.infer;
export type MysqlDatabaseConfig = typeof mysqlDatabaseConfigSchema.infer;
export type SqliteDatabaseConfig = typeof sqliteDatabaseConfigSchema.infer;
export type DatabaseConfig = typeof databaseConfigSchema.infer;

export type Config = typeof configSchema.infer;

type _DbOptionsSatisfiesDbProviders = ExpectTrue<
	Equal<DatabaseConfig["provider"], (typeof DATABASE_PROVIDERS)[number]>
>;
