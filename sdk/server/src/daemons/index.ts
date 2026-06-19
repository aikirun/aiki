import { delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
import type { ConfigProvider } from "@aikirun/types/infra/config";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { spawnDueTimersConsumer } from "./due-timers-consumer";
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
	signal: AbortSignal;
	configProvider: ConfigProvider<ServerConfig>;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

function pollingDaemon(logger: Logger, signal: AbortSignal, configProvider: ConfigProvider<ServerConfig>) {
	return {
		spawn<Deps, DaemonOptions>(
			getDaemonConfig: (config: ServerConfig) => DaemonOptions & { intervalMs: number },
			fn: (context: DaemonContext, deps: Deps, options: DaemonOptions) => Promise<void>,
			deps: Deps
		) {
			const name = fn.name;

			return (async () => {
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
		},
	};
}

export function initDaemons(logger: Logger, deps: InitDaemonsDeps) {
	const { configProvider, signal } = deps;
	const { spawn: spawnPollingDaemon } = pollingDaemon(logger, signal, configProvider);

	const daemonPromises: Promise<void>[] = [
		spawnPollingDaemon((config) => config.daemons.imminentScheduledRuns, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.daemons.imminentSleepElapsedRuns, processImminentSleepElapsedRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.daemons.imminentRetryableRuns, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.daemons.imminentRetryableTaskRuns, processImminentRetryableTaskRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.daemons.imminentEventWaitTimedOutRuns, processImminentEventWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon(
			(config) => config.daemons.imminentChildRunWaitTimedOutRuns,
			processImminentChildRunWaitTimedOutRuns,
			{
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
				timerPriorityQueue: deps.timerPriorityQueue,
			}
		),
		spawnPollingDaemon((config) => config.daemons.imminentRecurringWorkflows, processImminentRecurringWorkflows, {
			repos: deps.repos,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
	];

	if (deps.workflowRunPublisher) {
		daemonPromises.push(
			spawnPollingDaemon((config) => config.daemons.publishReadyRuns, publishReadyRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			}),
			spawnPollingDaemon((config) => config.daemons.republishStaleRuns, republishStaleRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			})
		);
	}

	if (deps.timerPriorityQueue) {
		daemonPromises.push(
			spawnDueTimersConsumer(logger, {
				repos: deps.repos,
				signal,
				timerPriorityQueue: deps.timerPriorityQueue,
				childRunCanceller: deps.childRunCanceller,
				workflowRunPublisher: deps.workflowRunPublisher,
				configProvider,
			})
		);
	}

	return {
		async stop() {
			await Promise.all(daemonPromises);
		},
	};
}
