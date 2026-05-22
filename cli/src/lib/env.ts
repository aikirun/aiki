import { config as dotenvConfig } from "dotenv";

export function loadEnv(envFile?: string): void {
	if (envFile) {
		dotenvConfig({ path: envFile });
	}
}
