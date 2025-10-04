import { type Config, configSchema } from "./schema.ts";

export function loadConfig(): Config {
	const raw = {
		PORT: Deno.env.get("PORT"),
		NODE_ENV: Deno.env.get("NODE_ENV"),
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
