import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type } from "arktype";
import { config } from "dotenv";

import { type Config, configSchema, DATABASE_PROVIDERS, isDatabaseProvider } from "./schema";

const loadDatabaseConfig = () => {
	const provider = process.env.DATABASE_PROVIDER ?? "pg";
	if (!isDatabaseProvider(provider)) {
		throw new Error(`Unsupported DATABASE_PROVIDER: ${provider}. Must be one of: ${DATABASE_PROVIDERS.join(", ")}`);
	}

	switch (provider) {
		case "sqlite":
			return {
				provider,
				path: process.env.DATABASE_PATH,
			};
		case "pg":
		case "mysql":
			return {
				provider,
				url: process.env.DATABASE_URL,
				maxConnections: process.env.DATABASE_MAX_CONNECTIONS,
				ssl: process.env.DATABASE_SSL,
			};
		default:
			provider satisfies never;
	}
};

export async function loadConfig(): Promise<Config> {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const envPath = join(__dirname, "../.env");

	config({ path: envPath });

	const raw = {
		port: process.env.AIKI_SERVER_PORT,
		baseURL: process.env.AIKI_SERVER_BASE_URL,
		redis: {
			host: process.env.REDIS_HOST,
			port: process.env.REDIS_PORT,
			password: process.env.REDIS_PASSWORD,
		},
		database: loadDatabaseConfig(),
		auth: {
			secret: process.env.AIKI_SERVER_AUTH_SECRET,
		},
		logLevel: process.env.LOG_LEVEL,
		prettyLogs: process.env.PRETTY_LOGS,
	};

	const result = configSchema(raw ?? {});
	if (result instanceof type.errors) {
		throw new Error(`Invalid config: ${result.summary}`);
	}

	return result;
}
