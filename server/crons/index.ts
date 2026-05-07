import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerSortedSet } from "server/infra/messaging/redis-timer-sorted-set";
import type { CronContext } from "server/middleware/context";
import { createCronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";

import { queueDueTimers } from "./due-timers";
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
	shutdown(): void;
}

function initCron<Deps, Options>(
	logger: Logger,
	intervalMs: number,
	fn: (context: CronContext, deps: Deps, options?: Options) => Promise<void>,
	deps: Deps,
	options?: Options
): {
	interval: ReturnType<typeof setInterval>;
	abortController: AbortController;
} {
	const name = fn.name;
	const abortController = new AbortController();
	const { signal } = abortController;

	let running = false;

	const interval = setInterval(() => {
		if (signal.aborted || running) {
			return;
		}
		running = true;

		const context = createCronContext({ name, logger, signal });
		const start = performance.now();
		fn(context, deps, options)
			.then(() => {
				const durationMs = Math.round(performance.now() - start);
				context.logger.debug({ durationMs }, `Cron ${name} completed`);
			})
			.catch((err) => {
				const durationMs = Math.round(performance.now() - start);
				context.logger.error({ err, durationMs }, `Cron ${name} failed`);
			})
			.finally(() => {
				running = false;
			});
	}, intervalMs);

	return { interval, abortController };
}

export function initCrons(logger: Logger, deps: InitCronsDeps): CronHandle {
	const crons = [
		initCron(logger, 1_000, processImminentScheduledRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentSleepElapsedRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentRetryableRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentRetryableTaskRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentEventWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentChildRunWaitTimedOutRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, processImminentRecurringWorkflows, {
			repos: deps.repos,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
	];

	if (deps.timerSortedSet) {
		crons.push(
			initCron(logger, 50, queueDueTimers, {
				repos: deps.repos,
				timerSortedSet: deps.timerSortedSet,
				childRunCanceller: deps.childRunCanceller,
				workflowRunPublisher: deps.workflowRunPublisher,
			})
		);
	}

	if (deps.workflowRunPublisher) {
		crons.push(
			...[
				initCron(logger, 1_000, publishReadyRuns, {
					repos: deps.repos,
					workflowRunPublisher: deps.workflowRunPublisher,
				}),
				initCron(logger, 1_000, republishStaleRuns, {
					repos: deps.repos,
					workflowRunPublisher: deps.workflowRunPublisher,
				}),
			]
		);
	}

	return {
		shutdown() {
			for (const { abortController, interval } of crons) {
				abortController.abort();
				clearInterval(interval);
			}
		},
	};
}
