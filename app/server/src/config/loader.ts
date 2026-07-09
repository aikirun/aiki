import process from "node:process";
import { type DatabaseConfig, loadDatabaseConfig } from "@aikirun/lib/db";
import { omitUndefined } from "@aikirun/lib/object";
import { type } from "arktype";
import { config as loadEnv } from "dotenv";

import { type Config, configSchema } from "./schema";

export async function loadAppServerConfig(params?: { path?: string }): Promise<Config & { db: DatabaseConfig }> {
	if (params?.path) {
		loadEnv({ path: params.path });
	}

	const db = loadDatabaseConfig();

	const redisRaw = process.env.REDIS_HOST
		? {
				host: process.env.REDIS_HOST,
				port: process.env.REDIS_PORT,
				password: process.env.REDIS_PASSWORD,
			}
		: undefined;

	const authRaw = process.env.AIKI_SERVER_AUTH_SECRET
		? {
				secret: process.env.AIKI_SERVER_AUTH_SECRET,
			}
		: undefined;

	const raw = omitUndefined({
		host: process.env.AIKI_SERVER_HOST,
		port: process.env.AIKI_SERVER_PORT,
		baseURL: process.env.AIKI_SERVER_BASE_URL,
		corsOrigins: process.env.CORS_ORIGINS,
		redis: redisRaw,
		auth: authRaw,
		logLevel: process.env.LOG_LEVEL,
		prettyLogs: process.env.PRETTY_LOGS,
	});

	const result = configSchema(raw);
	if (result instanceof type.errors) {
		throw new Error(`Invalid config: ${result.summary}`);
	}
	return { ...result, db };
}

export type AppServerConfig = Awaited<ReturnType<typeof loadAppServerConfig>>;
