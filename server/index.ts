import process from "node:process";
import { RPCHandler } from "@orpc/server/fetch";
import { Redis } from "ioredis";

import { loadConfig } from "./config/index";
import { initCrons } from "./crons";
import { UnauthorizedError } from "./errors";
import { createDatabase } from "./infra/db";
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
import { createWorkflowRunOutboxService } from "./service/workflow-run-outbox";
import { createWorkflowRunStateMachineService } from "./service/workflow-run-state-machine";

if (import.meta.main) {
	const config = await loadConfig();
	const logger = createLogger(config.logLevel, config.prettyLogs);

	const { repos, conn, betterAuthSchema } = createDatabase(config.database);

	let redis: Redis | undefined;
	let workflowRunPublisher: ReturnType<typeof createWorkflowRunPublisher> | undefined;

	if (config.redis) {
		redis = new Redis({
			host: config.redis.host,
			port: config.redis.port,
			password: config.redis.password,
		});
		redis.on("error", (err: Error) => {
			logger.error({ err }, "Redis connection error");
		});
		workflowRunPublisher = createWorkflowRunPublisher(redis);
	}

	const apiKeyService = createApiKeyService({ repos, redis });
	const authService = createAuthService({
		conn,
		provider: config.database.provider,
		betterAuthSchema,
		baseURL: config.baseURL,
		secret: config.auth.secret,
		corsOrigins: config.corsOrigins,
	});

	const { authorizeByApiKey, authorizeByOrganizationSession, authorizeByNamespaceSession } = createAuthorizer(
		apiKeyService,
		authService,
		repos.organization
	);

	const namespaceService = createNamespaceService(repos, apiKeyService);
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachineService = createWorkflowRunStateMachineService({
		repos,
		childRunCanceller,
	});
	const taskStateMachineService = createTaskStateMachineService({ repos });
	const workflowRunService = createWorkflowRunService({
		repos,
		childRunCanceller,
		workflowRunStateMachineService,
	});
	const workflowService = createWorkflowService({ repos });
	const scheduleService = createScheduleService({ repos });
	const workflowRunOutboxService = createWorkflowRunOutboxService({ repos });

	const crons = initCrons(logger, {
		repos,
		workflowRunPublisher,
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
		workflowRunOutboxService,
	});

	const organizationAuthedHandler = new RPCHandler(organizationAuthedRouter, {});
	const namespaceAuthedHandler = new RPCHandler(namespaceAuthedRouter, {});

	const { createCorsResponse, withCorsHeaders } = createCorsHelpers(config.corsOrigins);

	Bun.serve({
		hostname: config.host,
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
		if (redis) {
			await redis.quit();
		}
		process.exit(0);
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);

	logger.info(`Server running on ${config.host}:${config.port}`);
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
