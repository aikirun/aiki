import type { Equal, ExpectTrue } from "@aikirun/lib/testing/expect";
import { type } from "arktype";

const coerceBool = type("'true' | 'false' | '1' | '0'").pipe((v) => v === "true" || v === "1");

export const DATABASE_PROVIDERS = ["pg", "sqlite", "mysql"] as const;
export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];

export function isDatabaseProvider(provider: string): provider is DatabaseProvider {
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

export type PgDatabaseConfig = typeof pgDatabaseConfigSchema.infer;
export type MysqlDatabaseConfig = typeof mysqlDatabaseConfigSchema.infer;
export type SqliteDatabaseConfig = typeof sqliteDatabaseConfigSchema.infer;
export type DatabaseConfig = typeof databaseConfigSchema.infer;

type _DbOptionsSatisfiesDbProviders = ExpectTrue<
	Equal<DatabaseConfig["provider"], (typeof DATABASE_PROVIDERS)[number]>
>;
