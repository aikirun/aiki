import { settleWithin } from "@aikirun/lib/async";
import { asConfigProvider, type ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { merge } from "@aikirun/lib/object";
import type { Database } from "@aikirun/types/infra/db";
import { ulid } from "ulidx";

import { defaultServerRuntimeConfig, type ServerRuntimeConfig } from "./config";
import { spawnDaemons } from "./daemons";
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

			const configParam = params.runtime?.config;
			let configProvider: ConfigProvider<ServerRuntimeConfig>;
			if (typeof configParam === "function") {
				configProvider = configParam({ logger: logger.child({ "aiki.component": "config-provider" }), signal });
			} else {
				const config = merge(defaultServerRuntimeConfig, configParam);
				configProvider = asConfigProvider(() => config);
			}

			const daemonsPromise = spawnDaemons(logger, {
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

			return createRuntimeHandle({ logger, daemonsPromise, configProvider, abortController });
		},
	};
}

interface RuntimeHandleDeps {
	logger: Logger;
	daemonsPromise: Promise<void>;
	configProvider: ConfigProvider<ServerRuntimeConfig>;
	abortController: AbortController;
}

function createRuntimeHandle({
	configProvider,
	daemonsPromise,
	logger,
	abortController,
}: RuntimeHandleDeps): ServerRuntimeHandle {
	const id = ulid() as ServerRuntimeId;
	let stopPromise: Promise<void> | undefined;

	const _stop = async (): Promise<void> => {
		const gracefulShutdownTimeoutMs = configProvider.config.gracefulShutdownTimeoutMs;

		abortController.abort();

		if (gracefulShutdownTimeoutMs <= 0) {
			return;
		}

		const drained = await settleWithin(daemonsPromise, gracefulShutdownTimeoutMs);
		if (!drained) {
			logger.warn("Runtime did not shut down within graceful timeout", {
				"aiki.runtimeId": id,
				"aiki.gracefulShutdownTimeoutMs": gracefulShutdownTimeoutMs,
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
