// biome-ignore-all lint/suspicious/noConsole: logger hasn't been configured yet

import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

import { type Config, configSchema } from "./schema";

export async function loadConfig(): Promise<Config> {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	const envPath = join(__dirname, "../.env");

	config({ path: envPath });

	const raw = {
		port: process.env.AIKI_PORT,
		redis: {
			host: process.env.REDIS_HOST,
			port: process.env.REDIS_PORT,
			password: process.env.REDIS_PASSWORD,
		},
		logLevel: process.env.LOG_LEVEL,
		prettyLogs: process.env.PRETTY_LOGS,
	};

	const result = configSchema.safeParse(raw);
	if (!result.success) {
		console.error("Invalid configuration:");
		console.error(result.error.issues);
		process.exit(1);
	}

	return result.data;
}
