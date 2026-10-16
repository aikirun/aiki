import {
	asConfigProvider,
	type ConfigProvider,
	type CreateConfigProvider,
	validatedConfigProvider,
} from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { merge } from "@aikirun/lib/object";
import type { Database } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue/publisher";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";

import { defaultServerRuntimeConfig, type ServerRuntimeConfig, type ServerRuntimeConfigOverrides } from "./config";
import { validateServerRuntimeConfig } from "./config/runtime/schema";
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

	let configProvider: ConfigProvider<ServerRuntimeConfig>;
	if (typeof configParam === "function") {
		configProvider = configParam({ logger: logger.child({ "aiki.subComponent": "config-provider" }), signal });
	} else {
		const config = merge(defaultServerRuntimeConfig, configParam);
		configProvider = asConfigProvider(() => config);
	}
	configProvider = validatedConfigProvider({ provider: configProvider, validate: validateServerRuntimeConfig, logger });

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
