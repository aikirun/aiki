import { delay } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
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
import type { ServerRuntimeConfig } from "../config";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";

export interface SpawnDaemonsDeps {
	repos: Repositories;
	signal: AbortSignal;
	configProvider: ConfigProvider<ServerRuntimeConfig>;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

function pollingDaemon(
	logger: Logger,
	signal: AbortSignal,
	configProvider: ConfigProvider<ServerRuntimeConfig["daemons"]>
) {
	return {
		spawn<Deps, DaemonOptions>(
			getConfig: (config: ServerRuntimeConfig["daemons"]) => DaemonOptions & { intervalMs: number },
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
							const config = getConfig(configProvider.config);
							await fn(context, deps, config);
							const durationMs = Math.round(performance.now() - start);
							context.logger.debug("Completed", { durationMs });
							const delayMs = config.intervalMs - durationMs;
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

export function spawnDaemons(logger: Logger, deps: SpawnDaemonsDeps) {
	const { configProvider, signal } = deps;
	const { spawn: spawnPollingDaemon } = pollingDaemon(logger, signal, configProvider.scope("daemons"));

	const daemonPromises: Promise<void>[] = [
		spawnPollingDaemon((config) => config.imminentScheduledRuns, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentSleepElapsedRuns, processImminentSleepElapsedRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentRetryableRuns, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentRetryableTaskRuns, processImminentRetryableTaskRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentEventWaitTimedOutRuns, processImminentEventWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentChildRunWaitTimedOutRuns, processImminentChildRunWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		spawnPollingDaemon((config) => config.imminentRecurringWorkflows, processImminentRecurringWorkflows, {
			repos: deps.repos,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
	];

	if (deps.workflowRunPublisher) {
		daemonPromises.push(
			spawnPollingDaemon((config) => config.publishReadyRuns, publishReadyRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			}),
			spawnPollingDaemon((config) => config.republishStaleRuns, republishStaleRuns, {
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
				configProvider: configProvider.scope("daemons").scope("dueTimersConsumer"),
			})
		);
	}

	return Promise.allSettled(daemonPromises).then(() => {});
}
