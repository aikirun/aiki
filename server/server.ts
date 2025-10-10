import { loadConfig } from "./config/mod.ts";
import { RPCHandler } from "@orpc/server/fetch";
import { createContext } from "./middleware/mod.ts";
import { router } from "./router/mod.ts";

if (import.meta.main) {
	const config = await loadConfig();

	const rpcHandler = new RPCHandler(router, {
		// onSuccess: async (output, context) => {
		//   console.log('Success:', { output, context });
		// },
		// onError: async (error, context) => {
		//   console.error('Error:', { error, context });
		// },
	});

	Deno.serve({ port: config.port }, async (req) => {
		const context = createContext(req);

		const result = await rpcHandler.handle(req, { context });

		return result.response ?? new Response("Not Found", { status: 404 });
	});

	// deno-lint-ignore no-console
	console.log(`Aiki Server listening on http://localhost:${config.port}`);
}
