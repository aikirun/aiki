import { delay } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { startDueTimersConsumer } from "./due-timers-consumer";
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

export interface StartDaemonsDeps {
	repos: Repositories;
	signal: AbortSignal;
	configProvider: ConfigProvider<ServerRuntimeConfig>;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

const pollingDaemon = (
	logger: Logger,
	signal: AbortSignal,
	configProvider: ConfigProvider<ServerRuntimeConfig["daemons"]>
) => ({
	start<Deps, DaemonOptions>(
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
});

export async function startDaemons(logger: Logger, deps: StartDaemonsDeps): Promise<void> {
	const { repos, signal, configProvider, workflowRunPublisher, timerPriorityQueue, childRunCanceller } = deps;

	const { start: startPollingDaemon } = pollingDaemon(logger, signal, configProvider.scope("daemons"));

	const daemonPromises: Promise<void>[] = [
		startPollingDaemon((config) => config.imminentScheduledRuns, processImminentScheduledRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentSleepElapsedRuns, processImminentSleepElapsedRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentRetryableRuns, processImminentRetryableRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentRetryableTaskRuns, processImminentRetryableTaskRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentEventWaitTimedOutRuns, processImminentEventWaitTimedOutRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentChildRunWaitTimedOutRuns, processImminentChildRunWaitTimedOutRuns, {
			repos,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
		startPollingDaemon((config) => config.imminentRecurringWorkflows, processImminentRecurringWorkflows, {
			repos,
			childRunCanceller,
			workflowRunPublisher,
			timerPriorityQueue,
		}),
	];

	if (workflowRunPublisher) {
		daemonPromises.push(
			startPollingDaemon((config) => config.publishReadyRuns, publishReadyRuns, {
				repos,
				workflowRunPublisher,
			}),
			startPollingDaemon((config) => config.republishStaleRuns, republishStaleRuns, {
				repos,
				workflowRunPublisher,
			})
		);
	}

	if (timerPriorityQueue) {
		daemonPromises.push(
			startDueTimersConsumer(logger, {
				repos,
				signal,
				timerPriorityQueue,
				childRunCanceller,
				workflowRunPublisher,
				configProvider: configProvider.scope("daemons").scope("dueTimersConsumer"),
			})
		);
	}

	await Promise.allSettled(daemonPromises);
}
