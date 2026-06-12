import { delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import { withRetry } from "@aikirun/lib/retry";
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
import type { Repositories } from "../infra/db/types";
import type { DaemonContext } from "../middleware/context";
import { createDaemonContext } from "../middleware/context";
import type { ChildRunCanceller } from "../service/cancel-child-runs";

export interface InitDaemonsDeps {
	repos: Repositories;
	workflowRunPublisher?: Publisher;
	timerPriorityQueue?: TimerPriorityQueue;
	childRunCanceller: ChildRunCanceller;
}

function initDaemon<Deps, Options>(
	logger: Logger,
	intervalMs: number,
	fn: (context: DaemonContext, deps: Deps, options?: Options) => Promise<void>,
	deps: Deps,
	options?: Options
) {
	const name = fn.name;
	const abortController = new AbortController();
	const { signal } = abortController;

	const promise = withRetry(
		async () => {
			while (!signal.aborted) {
				const context = createDaemonContext({ name, logger, signal });
				const start = performance.now();
				await fn(context, deps, options);
				const durationMs = Math.round(performance.now() - start);
				context.logger.debug("Completed", { durationMs });
				const delayMs = intervalMs - durationMs;
				if (delayMs > 0) {
					await delay(delayMs, { abortSignal: signal });
				}
			}
		},
		{ type: "jittered", maxAttempts: Number.POSITIVE_INFINITY, baseDelayMs: 1_000, maxDelayMs: 30_000 },
		{
			abortSignal: signal,
			onError: (err) => {
				if (signal.aborted) {
					return;
				}
				logger.error(`Daemon ${name} failed`, { err });
			},
		}
	).run();

	return { abortController, promise };
}

export function initDaemons(logger: Logger, deps: InitDaemonsDeps) {
	const daemons = [
		initDaemon(logger, 1_000, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentSleepElapsedRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentRetryableTaskRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentEventWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentChildRunWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
		initDaemon(logger, 1_000, processImminentRecurringWorkflows, {
			repos: deps.repos,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerPriorityQueue: deps.timerPriorityQueue,
		}),
	];

	if (deps.workflowRunPublisher) {
		daemons.push(
			initDaemon(logger, 1_000, publishReadyRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			}),
			initDaemon(logger, 1_000, republishStaleRuns, {
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
