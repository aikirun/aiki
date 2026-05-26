import { delay } from "@aikirun/lib/async";
import { UnauthorizedError } from "@aikirun/lib/error";
import { ConsoleLogger, type Logger } from "@aikirun/lib/logger";
import type { Iam } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { Database } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue";
import type { CreateTimerSortedSet } from "@aikirun/types/infra/timer";
import { RPCHandler } from "@orpc/server/fetch";
import { ulid } from "ulidx";

import { initDaemons } from "./daemons";
import { createRepos } from "./infra/db/repo";
import { createNamespaceRequestContext, type NamespaceRequestContext } from "./middleware/context";
import { createNamespaceAuthedRouter } from "./router/index";
import { createChildRunCanceller } from "./service/cancel-child-runs";
import { createScheduleService } from "./service/schedule";
import { createTaskStateMachineService } from "./service/task-state-machine";
import { createWorkflowService } from "./service/workflow";
import { createWorkflowRunService } from "./service/workflow-run";
import { createWorkflowRunOutboxService } from "./service/workflow-run-outbox";
import { createWorkflowRunStateMachineService } from "./service/workflow-run-state-machine";

export interface ServerRuntimeOptions {
	gracefulShutdownTimeoutMs?: number;
}

export interface ServerRuntimeParams {
	publisher?: CreatePublisher;
	timerSortedSet?: CreateTimerSortedSet;
	options?: ServerRuntimeOptions;
}

export interface ServerParams {
	db: Database;
	iam: Iam;
	cache?: CreateCache;
	logger?: Logger;
	runtime?: ServerRuntimeParams;
}

export type ServerRuntimeId = string & { _brand: "runtime_id" };

export interface ServerRuntimeHandle {
	id: ServerRuntimeId;
	stop: () => Promise<void>;
}

export interface Server {
	handler: (request: Request) => Promise<Response>;
	runtime: { start: () => Promise<ServerRuntimeHandle> };
}

export function server(params: ServerParams): Server {
	const logger: Logger = params.logger ?? new ConsoleLogger();
	const repos = createRepos(params.db);

	const childRunCanceller = createChildRunCanceller();

	const createHandler = () => {
		const apiAuthorizer = params.iam.api?.({ logger });
		const dashboardIam = params.iam.dashboard?.({ logger });

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

		const namespaceAuthedRouter = createNamespaceAuthedRouter({
			workflowRunService,
			workflowRunStateMachineService,
			taskStateMachineService,
			workflowService,
			scheduleService,
			workflowRunOutboxService,
		});

		const namespaceAuthedHandler = new RPCHandler(namespaceAuthedRouter, {});

		return async (request: Request): Promise<Response> => {
			const pathname = new URL(request.url).pathname;

			if (pathname.startsWith("/api/")) {
				if (!apiAuthorizer) {
					return new Response("Not Found", { status: 404 });
				}

				let context: NamespaceRequestContext;
				try {
					context = await createNamespaceRequestContext({ request, logger, authorizer: apiAuthorizer });
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

			if (pathname.startsWith("/dashboard/")) {
				if (!dashboardIam) {
					return new Response("Not Found", { status: 404 });
				}
				return dashboardIam.organization(request);
			}

			if (pathname.startsWith("/auth/")) {
				if (!dashboardIam) {
					return new Response("Not Found", { status: 404 });
				}
				return dashboardIam.authenticator(request);
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
		async start(): Promise<ServerRuntimeHandle> {
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

function createRuntimeHandle(deps: RuntimeHandleDeps): ServerRuntimeHandle {
	const id = ulid() as ServerRuntimeId;
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
