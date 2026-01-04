import { logLevels } from "server/logger";
import { z } from "zod";

export const redisConfigSchema = z.object({
	host: z.string().default("localhost"),
	port: z.coerce.number().int().positive().default(6379),
	password: z.string().optional(),
});

export const configSchema = z.object({
	port: z.coerce.number().int().positive().default(9876),
	redis: redisConfigSchema,
	logLevel: z.enum(logLevels).default("info"),
	prettyLogs: z.coerce.boolean().default(false),
});

export type RedisConfig = z.infer<typeof redisConfigSchema>;
export type Config = z.infer<typeof configSchema>;
