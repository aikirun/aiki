import process from "node:process";
import { RPCHandler } from "@orpc/server/fetch";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import { createLogger, type Logger } from "./logger/index";
import { createContext } from "./middleware/index";
import { router } from "./router/index";
import {
	queueScheduledWorkflowRuns,
	scheduleEventWaitTimedOutWorkflowRuns,
	scheduleRetryableWorkflowRuns,
	scheduleSleepingWorkflowRuns,
	scheduleWorkflowRunsWithRetryableTask,
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

	const cronIntervals = initCrons(redis, logger);

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
		for (const interval of cronIntervals) {
			clearInterval(interval);
		}
		await redis.quit();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on port ${config.port}`);
}

function initCrons(redis: Redis, logger: Logger) {
	const queueScheduledWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "queueScheduledWorkflowRuns",
			logger,
		});
		queueScheduledWorkflowRuns(context, redis).catch((err) => {
			logger.error({ err }, "Error queueing scheduled workflows");
		});
	}, 500);

	const scheduleSleepingWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleSleepingWorkflowRuns",
			logger,
		});
		scheduleSleepingWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling sleeping workflows");
		});
	}, 500);

	const scheduleRetryableWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleRetryableWorkflowRuns",
			logger,
		});
		scheduleRetryableWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling retryable workflows");
		});
	}, 500);

	const scheduleWorkflowRunsWithRetryableTaskInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleWorkflowRunsWithRetryableTask",
			logger,
		});
		scheduleWorkflowRunsWithRetryableTask(context).catch((err) => {
			logger.error({ err }, "Error scheduling workflows with retryable task");
		});
	}, 500);

	const scheduleEventWaitTimedOutWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleEventWaitTimedOutWorkflowRuns",
			logger,
		});
		scheduleEventWaitTimedOutWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling event wait timed out workflows");
		});
	}, 500);

	return [
		queueScheduledWorkflowRunsInterval,
		scheduleSleepingWorkflowRunsInterval,
		scheduleRetryableWorkflowRunsInterval,
		scheduleWorkflowRunsWithRetryableTaskInterval,
		scheduleEventWaitTimedOutWorkflowRunsInterval,
	];
}
