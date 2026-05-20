import { delay } from "@aikirun/lib/async";
import { ConsoleLogger, type Logger } from "@aikirun/lib/logger";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { CreatePublisher } from "@aikirun/types/infra/queue";
import type { CreateTimerSortedSet } from "@aikirun/types/infra/timer";
import { RPCHandler } from "@orpc/server/fetch";
import { ulid } from "ulidx";

import type { DatabaseConfig } from "./config/schema";
import { initDaemons } from "./daemons";
import { UnauthorizedError } from "./errors";
import { createDatabase } from "./infra/db";
import { createAuthorizer } from "./middleware/authorization";
import {
	createNamespaceRequestContext,
	createOrganizationRequestContext,
	type NamespaceRequestContext,
	type OrganizationRequestContext,
} from "./middleware/context";
import { createNamespaceAuthedRouter, createOrganizationAuthedRouter } from "./router/index";
import { type ApiKeyAuthorizationInfo, createApiKeyService } from "./service/api-key";
import { createAuthService } from "./service/auth";
import { createChildRunCanceller } from "./service/cancel-child-runs";
import { createNamespaceService } from "./service/namespace";
import { createScheduleService } from "./service/schedule";
import { createTaskStateMachineService } from "./service/task-state-machine";
import { createWorkflowService } from "./service/workflow";
import { createWorkflowRunService } from "./service/workflow-run";
import { createWorkflowRunOutboxService } from "./service/workflow-run-outbox";
import { createWorkflowRunStateMachineService } from "./service/workflow-run-state-machine";

export interface ServerHandlerAuth {
	secret: string;
	baseURL: string;
	trustedOrigins: string[];
}

export interface ServerHandlerParams {
	auth: ServerHandlerAuth;
	cache?: CreateCache;
}

export interface ServerRuntimeOptions {
	gracefulShutdownTimeoutMs?: number;
}

export interface ServerRuntimeParams {
	publisher?: CreatePublisher;
	timerSortedSet?: CreateTimerSortedSet;
	options?: ServerRuntimeOptions;
}

export interface ServerParams {
	db: DatabaseConfig;
	logger?: Logger;
	handler: ServerHandlerParams;
	runtime?: ServerRuntimeParams;
}

export type RuntimeId = string & { _brand: "runtime_id" };

export interface RuntimeHandle {
	id: RuntimeId;
	stop: () => Promise<void>;
}

export interface Server {
	handler: (request: Request) => Promise<Response>;
	runtime: { start: () => Promise<RuntimeHandle> };
}

export function server(params: ServerParams): Server {
	const logger: Logger = params.logger ?? new ConsoleLogger();
	const { repos, conn, betterAuthSchema } = createDatabase(params.db);

	const childRunCanceller = createChildRunCanceller();

	const createHandler = () => {
		const apiKeyService = createApiKeyService({
			repos,
			cache: params.handler.cache?.<ApiKeyAuthorizationInfo>({
				logger: logger.child({ "aiki.component": "cache.apiKeyAuth" }),
				keyPrefix: "api_key:",
			}),
		});
		const authService = createAuthService({
			conn,
			provider: params.db.provider,
			betterAuthSchema,
			baseURL: params.handler.auth.baseURL,
			secret: params.handler.auth.secret,
			trustedOrigins: params.handler.auth.trustedOrigins,
		});

		const { authorizeByApiKey, authorizeByOrganizationSession, authorizeByNamespaceSession } = createAuthorizer(
			apiKeyService,
			authService,
			repos.organization
		);

		const namespaceService = createNamespaceService(repos, apiKeyService);

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

		return async (request: Request): Promise<Response> => {
			const pathname = new URL(request.url).pathname;

			if (pathname.startsWith("/api/")) {
				let context: NamespaceRequestContext;
				try {
					context = await createNamespaceRequestContext({ request, logger, authorizer: authorizeByApiKey });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return new Response(error.message, { status: 401 });
					}
					logger.error("Unhandled error", { error });
					return new Response("Internal Server Error", { status: 500 });
				}

				const result = await namespaceAuthedHandler.handle(request, { context, prefix: "/api" });
				return result.response ?? new Response("Not Found", { status: 404 });
			}

			if (pathname.startsWith("/web/namespace/")) {
				let context: OrganizationRequestContext;
				try {
					context = await createOrganizationRequestContext({
						request,
						logger,
						authorizer: authorizeByOrganizationSession,
					});
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return new Response(error.message, { status: 401 });
					}
					logger.error("Unhandled error", { error });
					return new Response("Internal Server Error", { status: 500 });
				}

				const result = await organizationAuthedHandler.handle(request, { context, prefix: "/web" });
				return result.response ?? new Response("Not Found", { status: 404 });
			}

			if (pathname.startsWith("/web/")) {
				let context: NamespaceRequestContext;
				try {
					context = await createNamespaceRequestContext({ request, logger, authorizer: authorizeByNamespaceSession });
				} catch (error) {
					if (error instanceof UnauthorizedError) {
						return new Response(error.message, { status: 401 });
					}
					logger.error("Unhandled error", { error });
					return new Response("Internal Server Error", { status: 500 });
				}

				const result = await namespaceAuthedHandler.handle(request, { context, prefix: "/web" });
				return result.response ?? new Response("Not Found", { status: 404 });
			}

			if (pathname.startsWith("/auth/")) {
				return await authService.handler(request);
			}

			if (pathname === "/health") {
				if (request.method !== "GET") {
					return new Response("Method Not Allowed", { status: 405 });
				}
				return Response.json({ status: "ok" });
			}

			return new Response("Not Found", { status: 404 });
		};
	};

	const createRuntime = () => ({
		async start(): Promise<RuntimeHandle> {
			const daemons = initDaemons(logger, {
				repos,
				workflowRunPublisher: params.runtime?.publisher?.({
					logger: logger.child({ "aiki.component": "workflow-run-publisher" }),
				}),
				timerSortedSet: params.runtime?.timerSortedSet?.({
					logger: logger.child({ "aiki.component": "timer-sorted-set" }),
				}),
				childRunCanceller,
			});

			const gracefulShutdownTimeoutMs = params.runtime?.options?.gracefulShutdownTimeoutMs ?? 5_000;

			return createRuntimeHandle({
				logger,
				daemons,
				gracefulShutdownTimeoutMs,
			});
		},
	});

	return { handler: createHandler(), runtime: createRuntime() };
}

interface RuntimeHandleDeps {
	logger: Logger;
	daemons: { shutdown: () => Promise<void> };
	gracefulShutdownTimeoutMs: number;
}

function createRuntimeHandle(deps: RuntimeHandleDeps): RuntimeHandle {
	const id = ulid() as RuntimeId;
	let stopPromise: Promise<void> | undefined;

	const _stop = async (): Promise<void> => {
		const daemonShutdownPromise = deps.daemons.shutdown();

		if (deps.gracefulShutdownTimeoutMs <= 0) {
			await daemonShutdownPromise;
			return;
		}

		const result = await Promise.race([
			daemonShutdownPromise.then(() => "done" as const),
			delay(deps.gracefulShutdownTimeoutMs).then(() => "timeout" as const),
		]);
		if (result === "timeout") {
			deps.logger.warn("Runtime did not shut down within graceful timeout", {
				"aiki.runtimeId": id,
				"aiki.gracefulShutdownTimeoutMs": deps.gracefulShutdownTimeoutMs,
			});
		}
	};

	return {
		id,
		stop(): Promise<void> {
			if (!stopPromise) {
				stopPromise = _stop();
			}
			return stopPromise;
		},
	};
}
