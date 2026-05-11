import { delay } from "@aikirun/lib/async";
import { withRetry } from "@aikirun/lib/retry";
import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerSortedSet } from "server/infra/messaging/redis-timer-sorted-set";
import type { CronContext } from "server/middleware/context";
import { createCronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";

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

export interface InitCronsDeps {
	repos: Repositories;
	workflowRunPublisher?: WorkflowRunPublisher;
	timerSortedSet?: TimerSortedSet;
	childRunCanceller: ChildRunCanceller;
}

export interface CronHandle {
	shutdown(): Promise<void>;
}

function initCron<Deps, Options>(
	logger: Logger,
	intervalMs: number,
	fn: (context: CronContext, deps: Deps, options?: Options) => Promise<void>,
	deps: Deps,
	options?: Options
) {
	const name = fn.name;
	const abortController = new AbortController();
	const { signal } = abortController;

	const promise = withRetry(
		async () => {
			while (!signal.aborted) {
				const context = createCronContext({ name, logger, signal });
				const start = performance.now();
				await fn(context, deps, options);
				const durationMs = Math.round(performance.now() - start);
				context.logger.debug({ durationMs }, `Cron ${name} completed`);
				await delay(Math.max(0, intervalMs - durationMs), { abortSignal: signal });
			}
		},
		{ type: "jittered", maxAttempts: Number.POSITIVE_INFINITY, baseDelayMs: 1_000, maxDelayMs: 30_000 },
		{
			abortSignal: signal,
			onError: (err) => logger.error({ err }, `Cron ${name} failed`),
		}
	).run();

	return { abortController, promise };
}

export function initCrons(logger: Logger, deps: InitCronsDeps): CronHandle {
	const crons = [
		initCron(logger, 2_000, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentSleepElapsedRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentRetryableTaskRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentEventWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentChildRunWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
		initCron(logger, 2_000, processImminentRecurringWorkflows, {
			repos: deps.repos,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
			timerSortedSet: deps.timerSortedSet,
		}),
	];

	let dueTimersConsumer: DueTimersConsumerHandle | undefined;
	if (deps.timerSortedSet) {
		dueTimersConsumer = spawnDueTimersConsumer(logger, {
			repos: deps.repos,
			timerSortedSet: deps.timerSortedSet,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
		});
	}

	if (deps.workflowRunPublisher) {
		crons.push(
			initCron(logger, 1_000, publishReadyRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			}),
			initCron(logger, 1_000, republishStaleRuns, {
				repos: deps.repos,
				workflowRunPublisher: deps.workflowRunPublisher,
			})
		);
	}

	return {
		async shutdown() {
			const cronPromises: Promise<unknown>[] = [];
			for (const { abortController, promise } of crons) {
				abortController.abort();
				cronPromises.push(promise);
			}
			await Promise.all(cronPromises);
			await dueTimersConsumer?.stop();
		},
	};
}
