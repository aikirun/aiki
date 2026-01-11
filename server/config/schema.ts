import { type } from "arktype";
import { logLevels } from "server/logger";

export const redisConfigSchema = type({
	host: "string = 'localhost'",
	port: "string.integer.parse | number.integer > 0 = 6379",
	"password?": "string | undefined",
});

const coerceBool = type("'true' | 'false' | '1' | '0'").pipe((v) => v === "true" || v === "1");

export const configSchema = type({
	port: "string.integer.parse | number.integer > 0 = 9850",
	redis: redisConfigSchema,
	logLevel: type.enumerated(...logLevels).default("info"),
	prettyLogs: type("boolean").or(coerceBool).default(false),
});

export type RedisConfig = typeof redisConfigSchema.infer;
export type Config = typeof configSchema.infer;
