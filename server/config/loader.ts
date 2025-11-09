import { load } from "@std/dotenv";
import { type Config, configSchema } from "./schema.ts";

export async function loadConfig(): Promise<Config> {
	await load({
		export: true,
		envPath: new URL("../.env", import.meta.url).pathname,
	});

	const raw = {
		port: Deno.env.get("AIKI_PORT"),
		redis: {
			host: Deno.env.get("REDIS_HOST"),
			port: Deno.env.get("REDIS_PORT"),
			password: Deno.env.get("REDIS_PASSWORD"),
		},
	};

	const result = configSchema.safeParse(raw);
	if (!result.success) {
		// deno-lint-ignore no-console
		console.error("Invalid configuration:");
		// deno-lint-ignore no-console
		console.error(result.error.issues);
		Deno.exit(1);
	}

	return result.data;
}
