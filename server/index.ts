import process from "node:process";
import { RPCHandler } from "@orpc/server/fetch";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import {
	queueScheduledWorkflowRuns,
	scheduleEventWaitTimedOutWorkflowRuns,
	scheduleRecurringWorkflows,
	scheduleRetryableWorkflowRuns,
	scheduleSleepingElapedWorkflowRuns,
	scheduleWorkflowRunsThatTimedOutWaitingForChild,
	scheduleWorkflowRunsWithRetryableTask,
} from "./crons";
import { createLogger, type Logger } from "./logger/index";
import { createContext } from "./middleware/index";
import { router } from "./router/index";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

	const redis = new Redis({
		host: config.redis.host,
		port: config.redis.port,
		password: config.redis.password,
	});

	redis.on("error", (err: Error) => {
		logger.error({ err }, "Redis connection error");
	});

	const rpcHandler = new RPCHandler(router, {});

	const cronIntervals = initCrons(redis, logger);

	Bun.serve({
		port: config.port,
		fetch: async (request) => {
			const corsHeaders = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, x-trace-id, Accept",
			};

			if (request.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: corsHeaders });
			}

			const context = createContext({
				type: "request",
				request,
				logger,
			});
			const result = await rpcHandler.handle(request, { context });

			const response = result.response ?? new Response("Not Found", { status: 404 });
			for (const [key, value] of Object.entries(corsHeaders)) {
				response.headers.set(key, value);
			}
			return response;
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

	const scheduleSleepingElapedWorkflowRunsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleSleepingElapedWorkflowRuns",
			logger,
		});
		scheduleSleepingElapedWorkflowRuns(context).catch((err) => {
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

	const scheduleWorkflowRunsThatTimedOutWaitingForChildInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleWorkflowRunsThatTimedOutWaitingForChild",
			logger,
		});
		scheduleWorkflowRunsThatTimedOutWaitingForChild(context).catch((err) => {
			logger.error({ err }, "Error scheduling workflows that timed out while waiting for child");
		});
	}, 100);

	const scheduleRecurringWorkflowsInterval = setInterval(() => {
		const context = createContext({
			type: "cron",
			name: "scheduleRecurringWorkflows",
			logger,
		});
		scheduleRecurringWorkflows(context).catch((err) => {
			logger.error({ err }, "Error scheduling recurring workflows");
		});
	}, 1000);

	return [
		queueScheduledWorkflowRunsInterval,
		scheduleSleepingElapedWorkflowRunsInterval,
		scheduleRetryableWorkflowRunsInterval,
		scheduleWorkflowRunsWithRetryableTaskInterval,
		scheduleEventWaitTimedOutWorkflowRunsInterval,
		scheduleWorkflowRunsThatTimedOutWaitingForChildInterval,
		scheduleRecurringWorkflowsInterval,
	];
}
