import { delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import type { ConfigProvider } from "@aikirun/types/infra/config";
import type { Database } from "@aikirun/types/infra/db";
import { ulid } from "ulidx";

import { type ServerConfig, staticConfigProvider } from "./config";
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

			const abortController = new AbortController();
			const { signal } = abortController;

			const createConfigProvider = params.runtime?.config ?? staticConfigProvider();
			const maybeConfigProvider = createConfigProvider({
				logger: logger.child({ "aiki.component": "config-provider" }),
				signal,
			});
			const configProvider = maybeConfigProvider instanceof Promise ? await maybeConfigProvider : maybeConfigProvider;

			const daemonsHandle = initDaemons(logger, {
				repos,
				configProvider,
				signal,
				workflowRunPublisher: params.runtime?.publisher?.({
					logger: logger.child({ "aiki.component": "workflow-run-publisher" }),
					signal,
				}),
				timerPriorityQueue: params.runtime?.timerPriorityQueue?.({
					logger: logger.child({ "aiki.component": "timer-sorted-set" }),
					signal,
				}),
				childRunCanceller,
			});

			return createRuntimeHandle({ logger, daemonsHandle, configProvider, abortController });
		},
	};
}

interface RuntimeHandleDeps {
	logger: Logger;
	daemonsHandle: { stop: () => Promise<void> };
	configProvider: ConfigProvider<ServerConfig>;
	abortController: AbortController;
}

function createRuntimeHandle({
	configProvider,
	daemonsHandle,
	logger,
	abortController,
}: RuntimeHandleDeps): ServerRuntimeHandle {
	const id = ulid() as ServerRuntimeId;
	let stopPromise: Promise<void> | undefined;

	const _stop = async (): Promise<void> => {
		const gracefulShutdownTimeoutMs = configProvider.config.gracefulShutdownTimeoutMs;

		abortController.abort();

		const daemonShutdownPromise = daemonsHandle.stop();

		if (gracefulShutdownTimeoutMs <= 0) {
			await daemonShutdownPromise;
		} else {
			const result = await Promise.race([
				daemonShutdownPromise.then(() => "done" as const),
				delay(gracefulShutdownTimeoutMs).then(() => "timeout" as const),
			]);
			if (result === "timeout") {
				logger.warn("Runtime did not shut down within graceful timeout", {
					"aiki.runtimeId": id,
					"aiki.gracefulShutdownTimeoutMs": gracefulShutdownTimeoutMs,
				});
			}
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
