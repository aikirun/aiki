import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.ts";
import { loadConfig } from "./config/mod.ts";

if (import.meta.main) {
	const config = await loadConfig();

	const server = createHTTPServer({
		router: appRouter,
	});

	server.listen(config.port);

	// deno-lint-ignore no-console
	console.log(`Aiki Server listening on http://localhost:${config.port}`);
}
