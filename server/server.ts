import process from "node:process";
import { RPCHandler } from "@orpc/server/fetch";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import { createLogger } from "./logger/index";
import { createContext } from "./middleware/index";
import { router } from "./router/index";
import {
	queueScheduledWorkflowRuns,
	scheduleRetryableWorkflowRuns,
	scheduleSleepingWorkflowRuns,
} from "./router/workflow-run";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

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

	const queueScheduledWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "queueScheduledWorkflowRuns",
			logger,
		});
		queueScheduledWorkflowRuns(context, redis).catch((err) => {
			logger.error({ err }, "Error queueing scheduled workflows");
		});
	}, 1_000);

	const scheduleSleepingWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleSleepingWorkflowRuns",
			logger,
		});
		scheduleSleepingWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling sleeping workflows");
		});
	}, 1_000);

	const scheduleRetryableWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleRetryableWorkflowRuns",
			logger,
		});
		scheduleRetryableWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling retryable workflows");
		});
	}, 1_000);

	Bun.serve({
		port: config.port,
		fetch: async (request) => {
			const context = createContext({
				type: "request",
				request,
				logger,
			});
			const result = await rpcHandler.handle(request, { context });
			return result.response ?? new Response("Not Found", { status: 404 });
		},
	});

	const shutdown = async () => {
		clearInterval(queueScheduledWorkflowRunsInterval);
		clearInterval(scheduleSleepingWorkflowRunsInterval);
		clearInterval(scheduleRetryableWorkflowRunsInterval);
		await redis.quit();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on port ${config.port}`);
}
