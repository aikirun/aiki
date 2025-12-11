import process from "node:process";
import { loadConfig } from "./config/index.ts";
import { RPCHandler } from "@orpc/server/fetch";
import { contextFactory } from "./middleware/index.ts";
import { router } from "./router/index.ts";
import {
	transitionRetryableWorkflowsToQueued,
	transitionScheduledWorkflowsToQueued,
	transitionSleepingWorkflowsToQueued,
} from "./router/workflow-run.ts";
import { Redis } from "ioredis";

if (import.meta.url === Bun.main) {
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
			transitionScheduledWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning scheduled workflows:", err);
			});
		},
		1_000,
	);

	const sleepingSchedulerInterval = setInterval(
		() => {
			transitionSleepingWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning sleeping workflows:", err);
			});
		},
		1_000,
	);

	const retrySchedulerInterval = setInterval(
		() => {
			transitionRetryableWorkflowsToQueued(redis).catch((err) => {
				// deno-lint-ignore no-console
				console.error("Error transitioning retryable workflows:", err);
			});
		},
		1_000,
	);

	Bun.serve({
		port: config.port,
		fetch: async (req) => {
			const context = contextFactory(req);

			const result = await rpcHandler.handle(req, { context });

			return result.response ?? new Response("Not Found", { status: 404 });
		},
	});

	const shutdown = async () => {
		clearInterval(scheduledSchedulerInterval);
		clearInterval(sleepingSchedulerInterval);
		clearInterval(retrySchedulerInterval);
		await redis.quit();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	console.log(`Server running on port ${config.port}`);
}
