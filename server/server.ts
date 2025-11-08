import { loadConfig } from "./config/mod.ts";
import { RPCHandler } from "@orpc/server/fetch";
import { contextFactory } from "./middleware/mod.ts";
import { router } from "./router/mod.ts";
import {
	transitionRetryableWorkflowsToQueued,
	transitionScheduledWorkflowsToQueued,
	transitionSleepingWorkflowsToQueued,
} from "./router/workflow-run.ts";
import { Redis } from "ioredis";

if (import.meta.main) {
	const config = await loadConfig();

	const redis = new Redis({
		host: config.redis.host,
		port: config.redis.port,
		password: config.redis.password,
	});

	redis.on("error", (err: Error) => {
		// deno-lint-ignore no-console
		console.error("Redis error:", err);
	});

	const rpcHandler = new RPCHandler(router, {
		// onSuccess: async (output, context) => {
		//   console.log('Success:', { output, context });
		// },
		// onError: async (error, context) => {
		//   console.error('Error:', { error, context });
		// },
	});

	const scheduledSchedulerInterval = setInterval(
		() => {
			// deno-lint-ignore no-console
			console.info("Checking for scheduled tasks");

			transitionScheduledWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning scheduled workflows:", err);
			});
		},
		500,
	);

	const sleepingSchedulerInterval = setInterval(
		() => {
			// deno-lint-ignore no-console
			console.info("Checking for sleeping tasks");

			transitionSleepingWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning sleeping workflows:", err);
			});
		},
		500,
	);

	const retrySchedulerInterval = setInterval(
		() => {
			// deno-lint-ignore no-console
			console.info("Checking for retryable tasks");

			transitionRetryableWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning retryable workflows:", err);
			});
		},
		1_000,
	);

	Deno.serve({ port: config.port }, async (req) => {
		const context = contextFactory(req);

		const result = await rpcHandler.handle(req, { context });

		return result.response ?? new Response("Not Found", { status: 404 });
	});

	globalThis.addEventListener("beforeunload", async () => {
		clearInterval(scheduledSchedulerInterval);
		clearInterval(sleepingSchedulerInterval);
		clearInterval(retrySchedulerInterval);
		await redis.quit();
	});
}
