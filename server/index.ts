import process from "node:process";
import { RPCHandler } from "@orpc/server/fetch";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import { initCrons } from "./crons";
import { UnauthorizedError } from "./errors";
import { createDatabaseConn } from "./infra/db";
import { createApiKeyRepository } from "./infra/db/repository/api-key";
import { createChildWorkflowRunWaitQueueRepository } from "./infra/db/repository/child-workflow-run-wait-queue";
import { createEventWaitQueueRepository } from "./infra/db/repository/event-wait-queue";
import { createNamespaceRepository } from "./infra/db/repository/namespace";
import { createScheduleRepository } from "./infra/db/repository/schedule";
import { createSleepQueueRepository } from "./infra/db/repository/sleep-queue";
import { createStateTransitionRepository } from "./infra/db/repository/state-transition";
import { createTaskRepository } from "./infra/db/repository/task";
import { createWorkflowRepository } from "./infra/db/repository/workflow";
import { createWorkflowRunRepository } from "./infra/db/repository/workflow-run";
import { createWorkflowRunOutboxRepository } from "./infra/db/repository/workflow-run-outbox";
import { createLogger } from "./infra/logger";
import { createWorkflowRunPublisher } from "./infra/messaging/redis-publisher";
import { createAuthorizer } from "./middleware/authorization";
import {
	createNamespaceRequestContext,
	createOrganizationRequestContext,
	type NamespaceRequestContext,
	type OrganizationRequestContext,
} from "./middleware/context";
import { createNamespaceAuthedRouter, createOrganizationAuthedRouter } from "./router/index";
import { createApiKeyService } from "./service/api-key";
import { createAuthService } from "./service/auth";
import { createChildRunCanceller } from "./service/cancel-child-runs";
import { createNamespaceService } from "./service/namespace";
import { createScheduleService } from "./service/schedule";
import { createTaskStateMachineService } from "./service/task-state-machine";
import { createWorkflowService } from "./service/workflow";
import { createWorkflowRunService } from "./service/workflow-run";
import { createWorkflowRunStateMachineService } from "./service/workflow-run-state-machine";

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

	const workflowRunPublisher = createWorkflowRunPublisher(redis);

	const apiKeyRepository = createApiKeyRepository(db);
	const namespaceRepository = createNamespaceRepository(db);
	const workflowRepo = createWorkflowRepository(db);
	const workflowRunRepo = createWorkflowRunRepository(db);
	const workflowRunOutboxRepo = createWorkflowRunOutboxRepository(db);
	const taskRepo = createTaskRepository(db);
	const stateTransitionRepo = createStateTransitionRepository(db);
	const scheduleRepo = createScheduleRepository(db);
	const sleepQueueRepo = createSleepQueueRepository(db);
	const eventWaitQueueRepo = createEventWaitQueueRepository(db);
	const childWorkflowRunWaitQueueRepo = createChildWorkflowRunWaitQueueRepository(db);

	const apiKeyService = createApiKeyService(apiKeyRepository, redis);
	const authService = createAuthService({
		db,
		baseURL: config.baseURL,
		secret: config.auth.secret,
		corsOrigins: config.corsOrigins,
	});

	const { authorizeByApiKey, authorizeByOrganizationSession, authorizeByNamespaceSession } = createAuthorizer(
		apiKeyService,
		authService
	);

	const namespaceService = createNamespaceService(namespaceRepository);
	const childRunCanceller = createChildRunCanceller({
		workflowRepo,
		workflowRunRepo,
		stateTransitionRepo,
	});
	const workflowRunStateMachineService = createWorkflowRunStateMachineService({
		db,
		workflowRunRepo,
		stateTransitionRepo,
		sleepQueueRepo,
		taskRepo,
		childWorkflowRunWaitQueueRepo,
		childRunCanceller,
	});
	const taskStateMachineService = createTaskStateMachineService({
		db,
		workflowRunRepo,
		taskRepo,
		stateTransitionRepo,
	});
	const workflowRunService = createWorkflowRunService({
		db,
		workflowRunRepo,
		workflowRepo,
		stateTransitionRepo,
		taskRepo,
		sleepQueueRepo,
		eventWaitQueueRepo,
		childWorkflowRunWaitQueueRepo,
		childRunCanceller,
		workflowRunStateMachineService,
	});
	const workflowService = createWorkflowService({
		workflowRepo,
		workflowRunRepo,
	});
	const scheduleService = createScheduleService({
		db,
		scheduleRepo,
		workflowRepo,
		workflowRunRepo,
	});

	const crons = initCrons(logger, {
		db,
		workflowRunPublisher,
		workflowRunOutboxRepo,
		workflowRunRepo,
		stateTransitionRepo,
		sleepQueueRepo,
		taskRepo,
		workflowRepo,
		scheduleRepo,
		eventWaitQueueRepo,
		childWorkflowRunWaitQueueRepo,
		childRunCanceller,
		scheduleService,
	});

	const organizationAuthedRouter = createOrganizationAuthedRouter(namespaceService);
	const namespaceAuthedRouter = createNamespaceAuthedRouter({
		apiKeyService,
		workflowRunService,
		workflowRunStateMachineService,
		taskStateMachineService,
		workflowService,
		scheduleService,
	});

	const organizationAuthedHandler = new RPCHandler(organizationAuthedRouter, {});
	const namespaceAuthedHandler = new RPCHandler(namespaceAuthedRouter, {});

	const { createCorsResponse, withCorsHeaders } = createCorsHelpers(config.corsOrigins);

	Bun.serve({
		port: config.port,
		routes: {
			"/health": async (request) => {
				if (request.method === "OPTIONS") return createCorsResponse(request);
				if (request.method !== "GET") {
					return withCorsHeaders(request, new Response("Method Not Allowed", { status: 405 }));
				}
				return withCorsHeaders(request, Response.json({ status: "ok" }));
			},
			"/auth/*": async (request) => {
				if (request.method === "OPTIONS") return createCorsResponse(request);
				return withCorsHeaders(request, await authService.handler(request));
			},
			"/api/*": async (request) => {
				if (request.method === "OPTIONS") return createCorsResponse(request);

				let context: NamespaceRequestContext;
				try {
					context = await createNamespaceRequestContext({ request, logger, authorizer: authorizeByApiKey });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return withCorsHeaders(request, new Response(error.message, { status: 401 }));
					}
					logger.error({ error }, "Unhandled error");
					return withCorsHeaders(request, new Response("Internal Server Error", { status: 500 }));
				}

				const result = await namespaceAuthedHandler.handle(request, { context, prefix: "/api" });
				return withCorsHeaders(request, result.response ?? new Response("Not Found", { status: 404 }));
			},
			"/web/namespace/*": async (request) => {
				if (request.method === "OPTIONS") return createCorsResponse(request);

				let context: OrganizationRequestContext;
				try {
					context = await createOrganizationRequestContext({
						request,
						logger,
						authorizer: authorizeByOrganizationSession,
					});
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return withCorsHeaders(request, new Response(error.message, { status: 401 }));
					}
					logger.error({ error }, "Unhandled error");
					return withCorsHeaders(request, new Response("Internal Server Error", { status: 500 }));
				}

				const result = await organizationAuthedHandler.handle(request, { context, prefix: "/web" });
				return withCorsHeaders(request, result.response ?? new Response("Not Found", { status: 404 }));
			},
			"/web/*": async (request) => {
				if (request.method === "OPTIONS") return createCorsResponse(request);

				let context: NamespaceRequestContext;
				try {
					context = await createNamespaceRequestContext({ request, logger, authorizer: authorizeByNamespaceSession });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return withCorsHeaders(request, new Response(error.message, { status: 401 }));
					}
					logger.error({ error }, "Unhandled error");
					return withCorsHeaders(request, new Response("Internal Server Error", { status: 500 }));
				}

				const result = await namespaceAuthedHandler.handle(request, { context, prefix: "/web" });
				return withCorsHeaders(request, result.response ?? new Response("Not Found", { status: 404 }));
			},
		},
		fetch: async (request) => withCorsHeaders(request, new Response("Not Found", { status: 404 })),
	});

	const shutdown = async () => {
		crons.shutdown();
		await redis.quit();
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on port ${config.port}`);
}

function createCorsHelpers(corsOrigins: string[]) {
	function getCorsHeaders(request: Request): Record<string, string> {
		const origin = request.headers.get("origin") || "";
		const allowedOrigin = corsOrigins.includes(origin) ? origin : "";
		return {
			"Access-Control-Allow-Origin": allowedOrigin,
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, x-trace-id, Accept",
			"Access-Control-Allow-Credentials": "true",
		};
	}

	function createCorsResponse(request: Request): Response {
		return new Response(null, { status: 204, headers: getCorsHeaders(request) });
	}

	function withCorsHeaders(request: Request, response: Response): Response {
		for (const [key, value] of Object.entries(getCorsHeaders(request))) {
			response.headers.set(key, value);
		}
		return response;
	}

	return { createCorsResponse, withCorsHeaders };
}
