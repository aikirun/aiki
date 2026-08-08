import { delay } from "@aikirun/lib/async";
import { asConfigProvider, type ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { startDueTimersConsumer } from "./due-timers-consumer";
import { processImminentChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { processImminentEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { processImminentRecurringRuns } from "./imminent-recurring-runs";
import { processImminentRetryableRuns } from "./imminent-retryable-runs";
import { processImminentRetryableTasks } from "./imminent-retryable-tasks";
import { processImminentScheduledRuns } from "./imminent-scheduled-runs";
import { processImminentSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import { publishPendingOutboxEntries } from "./publish-pending-outbox-entries";
import { recoverOverdueOutboxEntries } from "./recover-overdue-outbox-entries";
import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import type { ServerRuntimeConfig } from "../config";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";

export interface StartDaemonsDeps {
	repos: Repositories;
	signal: AbortSignal;
	configProvider: ConfigProvider<ServerRuntimeConfig>;
	publisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

const MIN_GAP_FRACTION = 0.2;
const JITTER_FRACTION = 0.1;

export const pollingDaemon = <DaemonConfig>(
	logger: Logger,
	signal: AbortSignal,
	configProvider: ConfigProvider<DaemonConfig>
) => ({
	start<Deps, DaemonOptions>(
		fn: (context: DaemonContext, deps: Deps, options: DaemonOptions) => Promise<void>,
		deps: Deps,
		getConfig: (config: DaemonConfig) => DaemonOptions & { intervalMs: number }
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
						context.logger.debug("Completed", { "aiki.durationMs": durationMs });

						// When a tick runs longer than the interval, the remaining delay goes negative.
						// Without a minimum delay the daemon would scan again immediately, hitting the
						// database hardest exactly when it is slowest.
						// The jitter adds or subtracts (both equally likely) a small random amount, so over
						// many ticks it cancels out and the average pace stays approximately intervalMs.
						// A new random amount is picked every tick, so daemons that started at the same
						// moment drift apart instead of scanning in sync forever.
						// The jitter is added last, so it can pull the delay below the minimum.
						// The most it can subtract is 10% of the interval and the minimum is 20% of the interval,
						// so the daemon always waits at least 10% of the interval.
						// Overlapping scans are safe regardless. This only trims wasted work, so both numbers
						// are rough on purpose and don't need config knobs.
						const durationUntilNextTickMs = config.intervalMs - durationMs;
						const jitterMs = (Math.random() * 2 - 1) * JITTER_FRACTION * config.intervalMs;
						const delayMs = Math.max(MIN_GAP_FRACTION * config.intervalMs, durationUntilNextTickMs) + jitterMs;
						await delay(delayMs, { signal });
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
	const { repos, signal, configProvider, publisher, timerPriorityQueue, childRunCanceller } = deps;

	const { start: startPollingDaemon } = pollingDaemon(logger, signal, configProvider.scope("daemons"));

	const daemonPromises: Promise<void>[] = [
		startPollingDaemon(processImminentScheduledRuns, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentScheduledRuns,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(processImminentSleepElapsedRuns, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentSleepElapsedRuns,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(processImminentRetryableRuns, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentRetryableRuns,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(processImminentRetryableTasks, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentRetryableTasks,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(processImminentEventWaitTimedOutRuns, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentEventWaitTimedOutRuns,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(processImminentChildRunWaitTimedOutRuns, { repos, publisher, timerPriorityQueue }, (config) => ({
			...config.imminentChildRunWaitTimedOutRuns,
			republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
		})),
		startPollingDaemon(
			processImminentRecurringRuns,
			{ repos, childRunCanceller, publisher, timerPriorityQueue },
			(config) => ({
				...config.imminentRecurringRuns,
				republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
			})
		),
		startPollingDaemon(recoverOverdueOutboxEntries, { repos }, (config) => config.recoverOverdueOutboxEntries),
		startPollingDaemon(stallUndeliverableRuns, { repos }, (config) => config.stallUndeliverableRuns),
	];

	if (publisher) {
		daemonPromises.push(
			startPollingDaemon(
				publishPendingOutboxEntries,
				{ repos, publisher },
				(config) => config.publishPendingOutboxEntries
			)
		);
	}

	if (timerPriorityQueue) {
		daemonPromises.push(
			startDueTimersConsumer(logger, {
				repos,
				signal,
				timerPriorityQueue,
				childRunCanceller,
				publisher,
				configProvider: asConfigProvider(() => {
					const config = configProvider.config.daemons;
					return {
						...config.dueTimersConsumer,
						republishBackoff: config.publishPendingOutboxEntries.republishBackoff,
					};
				}),
			})
		);
	}

	await Promise.allSettled(daemonPromises);
}
