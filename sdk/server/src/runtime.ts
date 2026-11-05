import { type ConfigProvider, type CreateConfigProvider, validatedConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue/publisher";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";

import { type ServerRuntimeConfig, type ServerRuntimeConfigOverrides, staticRuntimeConfigProvider } from "./config";
import { findUndeclaredServerRuntimeConfigKeys, validateServerRuntimeConfig } from "./config/runtime/schema";
import { startDaemons } from "./daemon";
import { createRepos } from "./infra/db/repo";

export interface StartRuntimeParams {
	db: Database;
	logger: Logger;
	signal: AbortSignal;
	publisher?: CreatePublisher;
	timerPriorityQueue?: CreateTimerPriorityQueue;
	config?: ServerRuntimeConfigOverrides | CreateConfigProvider<ServerRuntimeConfig>;
}

export interface StartedRuntime {
	configProvider: ConfigProvider<ServerRuntimeConfig>;
	daemonsPromise: Promise<void>;
}

export async function startRuntime(params: StartRuntimeParams): Promise<StartedRuntime> {
	const { logger: loggerParam, signal, config: configParam } = params;

	const logger = loggerParam.child({ "aiki.component": "server-runtime" });

	const createConfigProvider =
		typeof configParam === "function" ? configParam : staticRuntimeConfigProvider(configParam);
	const configProvider = validatedConfigProvider({
		provider: createConfigProvider({ logger: logger.child({ "aiki.subComponent": "config-provider" }), signal }),
		validate: (config) => {
			const result = validateServerRuntimeConfig(config);
			if (result.valid) {
				const undeclaredKeys = findUndeclaredServerRuntimeConfigKeys(config);
				if (undeclaredKeys.length > 0) {
					logger.warn("The config holds keys the server does not use, which are ignored", {
						"aiki.configKeys": undeclaredKeys,
					});
				}
			}
			return result;
		},
		logger,
	});

	const timerPriorityQueue = params.timerPriorityQueue?.({
		logger: logger.child({ "aiki.subComponent": "timer-priority-queue" }),
		signal,
	});

	if (!timerPriorityQueue) {
		logger.warn("No timer priority queue configured, runs may wake seconds later than expected.");
	}

	const repos = await createRepos(params.db);

	const daemonsPromise = startDaemons(logger, {
		repos,
		configProvider,
		signal,
		publisher: params.publisher?.({
			logger: logger.child({ "aiki.subComponent": "publisher" }),
			signal,
		}),
		timerPriorityQueue,
	});

	return { configProvider, daemonsPromise };
}
