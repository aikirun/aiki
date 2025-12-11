import process from "node:process";
import { loadConfig } from "./config/index";
import { RPCHandler } from "@orpc/server/fetch";
import { contextFactory } from "./middleware/index";
import { router } from "./router/index";
import {
	transitionRetryableWorkflowsToQueued,
	transitionScheduledWorkflowsToQueued,
	transitionSleepingWorkflowsToQueued,
} from "./router/workflow-run";
import { Redis } from "ioredis";
import { createLogger } from "./logger/index";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel);

	const redis = new Redis({
		host: config.redis.host,
		port: config.redis.port,
		password: config.redis.password,
	});

	redis.on("error", (err: Error) => {
		logger.error(
			{
				err,
			},
			"Redis connection error"
		);
	});

	const rpcHandler = new RPCHandler(router, {
		// onSuccess: async (output, context) => {
		// 	logger.info(
		// 		{
		// 			output,
		// 			context,
		// 		},
		// 		"Success"
		// 	);
		// },
		// onError: async (error, context) => {
		// 	logger.error(
		// 		{
		// 			error,
		// 			context,
		// 		},
		// 		"Success"
		// 	);
		// },
	});

	const scheduledSchedulerInterval = setInterval(() => {
		transitionScheduledWorkflowsToQueued(redis, logger).catch((err) => {
			logger.error(
				{
					err,
				},
				"Error transitioning scheduled workflows"
			);
		});
	}, 1_000);

	const sleepingSchedulerInterval = setInterval(() => {
		transitionSleepingWorkflowsToQueued(redis, logger).catch((err) => {
			logger.error(
				{
					err,
				},
				"Error transitioning sleeping workflows"
			);
		});
	}, 1_000);

	const retrySchedulerInterval = setInterval(() => {
		transitionRetryableWorkflowsToQueued(redis, logger).catch((err) => {
			logger.error(
				{
					err,
				},
				"Error transitioning retryable workflows"
			);
		});
	}, 1_000);

	Bun.serve({
		port: config.port,
		fetch: async (req) => {
			const context = contextFactory(req, logger);

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

	logger.info(`Server running on port ${config.port}`);
}
