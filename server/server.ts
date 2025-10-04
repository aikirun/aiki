import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.ts";

if (import.meta.main) {
	const server = createHTTPServer({
		router: appRouter,
	});

	// TODO: get from config
	const port = 3000;

	server.listen(port);

	// deno-lint-ignore no-console
	console.log(`Aiki Server listening on http://localhost:${port}`);
}
