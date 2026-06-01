import { delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import { ulid } from "ulidx";

import { initDaemons } from "./daemons";
import { createRepos } from "./infra/db/repo";
import type { ServerRuntimeHandle, ServerRuntimeId, ServerRuntimeParams } from "./server";
import { createChildRunCanceller } from "./service/cancel-child-runs";

export interface CreateRuntimeParams {
	db: Database;
	logger: Logger;
	runtime?: ServerRuntimeParams;
}

export function createRuntime(params: CreateRuntimeParams) {
	return {
		async start(): Promise<ServerRuntimeHandle> {
			const { logger } = params;
			const repos = await createRepos(params.db);
			const childRunCanceller = createChildRunCanceller();

			const daemons = initDaemons(logger, {
				repos,
				workflowRunPublisher: params.runtime?.publisher?.({
					logger: logger.child({ "aiki.component": "workflow-run-publisher" }),
				}),
				timerPriorityQueue: params.runtime?.timerPriorityQueue?.({
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
	};
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
