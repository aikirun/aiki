import { asConfigProvider, type ConfigProvider, type CreateConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { merge } from "@aikirun/lib/object";
import type { Database } from "@aikirun/types/infra/db";
import type { CreatePublisher } from "@aikirun/types/infra/queue/publisher";
import type { CreateTimerPriorityQueue } from "@aikirun/types/infra/timer";

import { defaultServerRuntimeConfig, type ServerRuntimeConfig, type ServerRuntimeConfigOverrides } from "./config";
import { startDaemons } from "./daemon";
import { createRepos } from "./infra/db/repo";
import { createImminentRunTimerQueue } from "./infra/timer/imminent-run-timer-queue";
import { createChildRunCanceller } from "./service/cancel-child-runs";

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
	const { logger, signal, config: configParam } = params;

	let configProvider: ConfigProvider<ServerRuntimeConfig>;
	if (typeof configParam === "function") {
		configProvider = configParam({ logger: logger.child({ "aiki.component": "config-provider" }), signal });
	} else {
		const config = merge(defaultServerRuntimeConfig, configParam);
		configProvider = asConfigProvider(() => config);
	}

	const timerPriorityQueue = params.timerPriorityQueue?.({
		logger: logger.child({ "aiki.component": "timer-priority-queue" }),
		signal,
	});

	const childRunCanceller = createChildRunCanceller(
		timerPriorityQueue &&
			createImminentRunTimerQueue({
				timerPriorityQueue,
				configProvider: asConfigProvider(() => ({
					lookaheadWindowMs: configProvider.config.daemons.imminentScheduledRuns.lookaheadWindowMs,
				})),
				logger,
			})
	);

	const repos = await createRepos(params.db);

	const daemonsPromise = startDaemons(logger, {
		repos,
		configProvider,
		signal,
		publisher: params.publisher?.({
			logger: logger.child({ "aiki.component": "publisher" }),
			signal,
		}),
		timerPriorityQueue,
		childRunCanceller,
	});

	return { configProvider, daemonsPromise };
}
