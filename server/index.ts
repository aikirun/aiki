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
import { UnauthorizedError } from "./errors";
import { createDatabaseConn } from "./infra/db";
import { createApiKeyRepository } from "./infra/db/repository/api-key";
import { createLogger, type Logger } from "./infra/logger";
import { createAuthorizer } from "./middleware/authorization";
import { type AuthedRequestContext, createAuthedRequestContext, createCronContext } from "./middleware/context";
import { authedRouter } from "./router/index";
import { createApiKeyService } from "./service/api-key";
import { createAuthService } from "./service/auth";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

	const db = createDatabaseConn(config.database);

	const redis = new Redis({
		host: config.redis.host,
		port: config.redis.port,
		password: config.redis.password,
	});
	redis.on("error", (err: Error) => {
		logger.error({ err }, "Redis connection error");
	});

	const apiKeyRepository = createApiKeyRepository(db);

	const apiKeyService = createApiKeyService(apiKeyRepository, redis);
	const authService = createAuthService({ db, baseURL: config.baseURL, secret: config.auth.secret });

	const { authorizeByApiKey, authorizeBySession } = createAuthorizer(apiKeyService, authService);

	const authedHandler = new RPCHandler(authedRouter, {});

	const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, x-trace-id, Accept",
	};
	const corsResponse = new Response(null, { status: 204, headers: corsHeaders });
	function withCorsHeaders(response: Response): Response {
		for (const [key, value] of Object.entries(corsHeaders)) {
			response.headers.set(key, value);
		}
		return response;
	}

	Bun.serve({
		port: config.port,
		routes: {
			"/health": async (request) => {
				if (request.method === "OPTIONS") return corsResponse;
				if (request.method !== "GET") {
					return withCorsHeaders(new Response("Method Not Allowed", { status: 405 }));
				}
				return withCorsHeaders(Response.json({ status: "ok" }));
			},
			"/api/*": async (request) => {
				if (request.method === "OPTIONS") return corsResponse;

				let context: AuthedRequestContext;
				try {
					context = await createAuthedRequestContext({ request, logger, authorizer: authorizeByApiKey });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return withCorsHeaders(new Response(error.message, { status: 401 }));
					}
					logger.error({ error }, "Unhandled error");
					return withCorsHeaders(new Response("Internal Server Error", { status: 500 }));
				}

				const result = await authedHandler.handle(request, { context, prefix: "/api" });
				return withCorsHeaders(result.response ?? new Response("Not Found", { status: 404 }));
			},
			"/web/*": async (request) => {
				if (request.method === "OPTIONS") return corsResponse;

				let context: AuthedRequestContext;
				try {
					context = await createAuthedRequestContext({ request, logger, authorizer: authorizeBySession });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return withCorsHeaders(new Response(error.message, { status: 401 }));
					}
					logger.error({ error }, "Unhandled error");
					return withCorsHeaders(new Response("Internal Server Error", { status: 500 }));
				}

				const result = await authedHandler.handle(request, { context, prefix: "/web" });
				return withCorsHeaders(result.response ?? new Response("Not Found", { status: 404 }));
			},
		},
		fetch: async () => withCorsHeaders(new Response("Not Found", { status: 404 })),
	});

	const cronIntervals = initCrons(redis, logger);

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
		const context = createCronContext({ name: "queueScheduledWorkflowRuns", logger });
		queueScheduledWorkflowRuns(context, redis).catch((err) => {
			logger.error({ err }, "Error queueing scheduled workflows");
		});
	}, 500);

	const scheduleSleepingElapedWorkflowRunsInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleSleepingElapedWorkflowRuns", logger });
		scheduleSleepingElapedWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling sleeping workflows");
		});
	}, 500);

	const scheduleRetryableWorkflowRunsInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleRetryableWorkflowRuns", logger });
		scheduleRetryableWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling retryable workflows");
		});
	}, 500);

	const scheduleWorkflowRunsWithRetryableTaskInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleWorkflowRunsWithRetryableTask", logger });
		scheduleWorkflowRunsWithRetryableTask(context).catch((err) => {
			logger.error({ err }, "Error scheduling workflows with retryable task");
		});
	}, 500);

	const scheduleEventWaitTimedOutWorkflowRunsInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleEventWaitTimedOutWorkflowRuns", logger });
		scheduleEventWaitTimedOutWorkflowRuns(context).catch((err) => {
			logger.error({ err }, "Error scheduling event wait timed out workflows");
		});
	}, 500);

	const scheduleWorkflowRunsThatTimedOutWaitingForChildInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleWorkflowRunsThatTimedOutWaitingForChild", logger });
		scheduleWorkflowRunsThatTimedOutWaitingForChild(context).catch((err) => {
			logger.error({ err }, "Error scheduling workflows that timed out while waiting for child");
		});
	}, 100);

	const scheduleRecurringWorkflowsInterval = setInterval(() => {
		const context = createCronContext({ name: "scheduleRecurringWorkflows", logger });
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
