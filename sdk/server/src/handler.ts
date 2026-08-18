import { asConfigProvider, type ConfigProvider, type CreatePassiveConfigProvider } from "@aikirun/lib/config";
import { UnauthorizedError } from "@aikirun/lib/error";
import { SENTINEL_ULID } from "@aikirun/lib/id";
import type { Logger } from "@aikirun/lib/logger";
import { merge } from "@aikirun/lib/object";
import type { ApiAuthorizer, Iam, IamContext } from "@aikirun/types/iam";
import type { CreateCache } from "@aikirun/types/infra/cache";
import type { Database } from "@aikirun/types/infra/db";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { OrganizationId } from "@aikirun/types/organization";
import { RPCHandler } from "@orpc/server/fetch";

import type { Capabilities } from "./capabilities";
import { defaultServerHandlerConfig, type ServerHandlerConfig, type ServerHandlerConfigOverrides } from "./config";
import { createRepos } from "./infra/db/repo";
import { createImminentRunTimerQueue } from "./infra/timer/imminent-run-timer-queue";
import { createNamespaceRequestContext, type NamespaceRequestContext } from "./middleware/context";
import { createNamespaceAuthedRouter } from "./router/index";
import { createChildRunCanceller } from "./service/cancel-child-runs";
import { createScheduleService } from "./service/schedule";
import { createTaskStateMachine } from "./service/state-machine/task";
import { createWorkflowRunStateMachine } from "./service/state-machine/workflow-run";
import { createTaskService } from "./service/task";
import { createWorkflowService } from "./service/workflow";
import { createWorkflowRunService } from "./service/workflow-run";
import { createWorkflowRunOutboxService } from "./service/workflow-run-outbox";
import packageJson from "../package.json";

export interface CreateHandlerParams {
	db: Database;
	logger: Logger;
	iam?: Iam;
	cache?: CreateCache;
	timerPriorityQueue?: CreateTimerPriorityQueue;
	config?: ServerHandlerConfigOverrides | CreatePassiveConfigProvider<ServerHandlerConfig>;
}

export async function createHandler(params: CreateHandlerParams) {
	const { logger: loggerParam, iam, config: configParam } = params;
	const repos = await createRepos(params.db);

	const logger = loggerParam.child({ "aiki.component": "server-handler" });

	let configProvider: ConfigProvider<ServerHandlerConfig>;
	if (typeof configParam === "function") {
		configProvider = configParam({ logger: logger.child({ "aiki.subComponent": "config-provider" }) });
	} else {
		const config = merge(defaultServerHandlerConfig, configParam);
		configProvider = asConfigProvider(() => config);
	}

	const timerPriorityQueue = params.timerPriorityQueue?.({
		logger: logger.child({ "aiki.subComponent": "timer-priority-queue" }),
	});
	const imminentRunTimerQueue =
		timerPriorityQueue &&
		createImminentRunTimerQueue({
			timerPriorityQueue,
			configProvider: configProvider.scope("imminentRuns"),
			logger,
		});

	const childRunCanceller = createChildRunCanceller(imminentRunTimerQueue);

	const apiAuthorizer = (iam?.api ?? noopApiAuthorizer)({ logger });
	const dashboardIam = iam?.dashboard?.({ logger });

	const workflowRunStateMachine = createWorkflowRunStateMachine({
		repos,
		childRunCanceller,
		imminentRunTimerQueue,
	});
	const taskStateMachine = createTaskStateMachine({ repos });
	const workflowRunService = createWorkflowRunService({
		repos,
		childRunCanceller,
		workflowRunStateMachine,
		imminentRunTimerQueue,
	});
	const workflowService = createWorkflowService({ repos });
	const scheduleService = createScheduleService({ repos });
	const taskService = createTaskService({ repos });
	const workflowRunOutboxService = createWorkflowRunOutboxService({ repos });

	const namespaceAuthedRouter = createNamespaceAuthedRouter({
		workflowRunService,
		workflowRunStateMachine,
		taskStateMachine,
		taskService,
		workflowService,
		scheduleService,
		workflowRunOutboxService,
	});

	const namespaceAuthedHandler = new RPCHandler(namespaceAuthedRouter, {});

	return async (request: Request): Promise<Response> => {
		const pathname = new URL(request.url).pathname;

		if (pathname.startsWith("/api/")) {
			let context: NamespaceRequestContext;
			try {
				context = await createNamespaceRequestContext({ request, logger, authorizer: apiAuthorizer });
			} catch (err) {
				if (err instanceof UnauthorizedError) {
					return new Response(err.message, { status: 401 });
				}
				logger.error("Unhandled error", { err });
				return new Response("Internal Server Error", { status: 500 });
			}

			const result = await namespaceAuthedHandler.handle(request, { context, prefix: "/api" });
			return result.response ?? new Response("Not Found", { status: 404 });
		}

		if (pathname.startsWith("/dashboard/")) {
			if (!dashboardIam?.organization) {
				return new Response("Not Found", { status: 404 });
			}
			return dashboardIam.organization(request);
		}

		if (pathname.startsWith("/auth/")) {
			if (!dashboardIam?.authenticator) {
				return new Response("Not Found", { status: 404 });
			}
			return dashboardIam.authenticator(request);
		}

		if (pathname === "/capabilities") {
			if (request.method !== "GET") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			return Response.json({
				version: packageJson.version,
				iam: { dashboard: dashboardIam !== undefined },
			} satisfies Capabilities);
		}

		if (pathname === "/health") {
			if (request.method !== "GET") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			return Response.json({ status: "ok" });
		}

		return new Response("Not Found", { status: 404 });
	};
}

function noopApiAuthorizer(_context: IamContext): ApiAuthorizer {
	return async () => ({
		organizationId: SENTINEL_ULID as OrganizationId,
		namespaceId: SENTINEL_ULID as NamespaceId,
	});
}
