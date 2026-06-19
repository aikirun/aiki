import { delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
import type { ConfigProvider } from "@aikirun/types/infra/config";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { type DueTimersConsumerHandle, spawnDueTimersConsumer } from "./due-timers-consumer";
import { processImminentChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { processImminentEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { processImminentRecurringWorkflows } from "./imminent-recurring-workflows";
import { processImminentRetryableRuns } from "./imminent-retryable-runs";
import { processImminentRetryableTaskRuns } from "./imminent-retryable-task-runs";
import { processImminentScheduledRuns } from "./imminent-scheduled-runs";
import { processImminentSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import { publishReadyRuns } from "./publish-ready-runs";
import { republishStaleRuns } from "./republish-stale-runs";
import type { ServerConfig } from "../config";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";

export interface InitDaemonsDeps {
	repos: Repositories;
	configProvider: ConfigProvider<ServerConfig>;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

function initDaemon<Deps, DaemonOptions>(
	logger: Logger,
	configProvider: ConfigProvider<ServerConfig>,
	getDaemonConfig: (config: ServerConfig) => DaemonOptions & { intervalMs: number },
	fn: (context: DaemonContext, deps: Deps, options: DaemonOptions) => Promise<void>,
	deps: Deps
) {
	const name = fn.name;
	const abortController = new AbortController();
	const { signal } = abortController;

	const promise = (async () => {
		while (!signal.aborted) {
			const context = createDaemonContext({ name, logger, signal });
			const start = performance.now();
			await withRetry(
				async () => {
					const daemonConfig = getDaemonConfig(configProvider.config);
					await fn(context, deps, daemonConfig);
					const durationMs = Math.round(performance.now() - start);
					context.logger.debug("Completed", { durationMs });
					const delayMs = daemonConfig.intervalMs - durationMs;
					if (delayMs > 0) {
						await delay(delayMs, { signal });
					}
				},
				{ type: "jittered", maxAttempts: Number.POSITIVE_INFINITY, baseDelayMs: 1_000, maxDelayMs: 30_000 },
				{
					signal,
					onError: (err) => {
						if (signal.aborted) {
							return;
						}
						logger.error(`Daemon ${name} failed`, { err });
					},
				}
			).run();
		}
	})();

	return { abortController, promise };
}

export function initDaemons(logger: Logger, deps: InitDaemonsDeps) {
	const { configProvider } = deps;

	const daemons = [
		initDaemon(logger, configProvider, (config) => config.daemons.imminentScheduledRuns, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(
			logger,
			configProvider,
			(config) => config.daemons.imminentSleepElapsedRuns,
			processImminentSleepElapsedRuns,
			{
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
		initDaemon(logger, configProvider, (config) => config.daemons.imminentRetryableRuns, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(
			logger,
			configProvider,
			(config) => config.daemons.imminentRetryableTaskRuns,
			processImminentRetryableTaskRuns,
			{
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
		initDaemon(
			logger,
			configProvider,
			(config) => config.daemons.imminentEventWaitTimedOutRuns,
			processImminentEventWaitTimedOutRuns,
			{
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
		initDaemon(
			logger,
			configProvider,
			(config) => config.daemons.imminentChildRunWaitTimedOutRuns,
			processImminentChildRunWaitTimedOutRuns,
			{
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
		initDaemon(
			logger,
			configProvider,
			(config) => config.daemons.imminentRecurringWorkflows,
			processImminentRecurringWorkflows,
			{
				repos: deps.repos,
				childRunCanceller: deps.childRunCanceller,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
	];

	if (deps.workflowRunPublisher) {
		daemons.push(
			initDaemon(logger, configProvider, (config) => config.daemons.publishReadyRuns, publishReadyRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			}),
			initDaemon(logger, configProvider, (config) => config.daemons.republishStaleRuns, republishStaleRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			})
		);
	}

	let dueTimersConsumer: DueTimersConsumerHandle | undefined;
	if (deps.timerPriorityQueue) {
		dueTimersConsumer = spawnDueTimersConsumer(logger, {
			repos: deps.repos,
			timerPriorityQueue: deps.timerPriorityQueue,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
			configProvider,
		});
	}

	return {
		async stop() {
			const daemonPromises: Promise<unknown>[] = [];
			for (const { abortController, promise } of daemons) {
				abortController.abort();
				daemonPromises.push(promise);
			}
			await Promise.all(daemonPromises);
			await dueTimersConsumer?.stop();
		},
	};
}
