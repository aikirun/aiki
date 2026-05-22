import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { omitUndefined } from "@aikirun/lib/object";
import { loadDatabaseConfig } from "@aikirun/server/config";
import { type } from "arktype";
import { config } from "dotenv";

import { type Config, configSchema } from "./schema";

export async function loadConfig(): Promise<Config> {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const envPath = join(__dirname, "../.env");

	config({ path: envPath });

	const redis = process.env.REDIS_HOST
		? {
				host: process.env.REDIS_HOST,
				port: process.env.REDIS_PORT,
				password: process.env.REDIS_PASSWORD,
			}
		: undefined;

	const raw = {
		host: process.env.AIKI_SERVER_HOST,
		port: process.env.AIKI_SERVER_PORT,
		baseURL: process.env.AIKI_SERVER_BASE_URL,
		corsOrigins: process.env.CORS_ORIGINS,
		redis,
		database: loadDatabaseConfig(),
		auth: {
			secret: process.env.AIKI_SERVER_AUTH_SECRET,
		},
		logLevel: process.env.LOG_LEVEL,
		prettyLogs: process.env.PRETTY_LOGS,
	};

	const result = configSchema(omitUndefined(raw));
	if (result instanceof type.errors) {
		throw new Error(`Invalid config: ${result.summary}`);
	}

	return result;
}
