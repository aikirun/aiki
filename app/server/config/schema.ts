import { databaseConfigSchema } from "@aikirun/server/config";
import { type } from "arktype";

import { logLevels } from "../logger";

const coerceBool = type("'true' | 'false' | '1' | '0'").pipe((v) => v === "true" || v === "1");

const uniqueCommaSeparatedToItems = type("string > 0").pipe((v) =>
	Array.from(
		new Set(
			v
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
		)
	)
);

export const redisConfigSchema = type({
	host: "string > 0 = 'localhost'",
	port: "string.integer.parse | number.integer > 0 = 6379",
	"password?": "string | undefined",
});

export const authConfigSchema = type({
	secret: "string > 0",
});

export const configSchema = type({
	port: "string.integer.parse | number.integer > 0 = 9850",
	host: "string > 0 = '0.0.0.0'",
	baseURL: "string > 0",
	corsOrigins: uniqueCommaSeparatedToItems,
	"redis?": redisConfigSchema.or(type("undefined")),
	database: databaseConfigSchema,
	auth: authConfigSchema,
	logLevel: type.enumerated(...logLevels).default("info"),
	prettyLogs: type("boolean").or(coerceBool).default(false),
});

export type RedisConfig = typeof redisConfigSchema.infer;
export type AuthConfig = typeof authConfigSchema.infer;

export type Config = typeof configSchema.infer;
