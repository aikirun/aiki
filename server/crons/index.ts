import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";
import { createCronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import type { ScheduleService } from "server/service/schedule";

import { publishReadyRuns } from "./publish-ready-runs";
import { queueChildRunWaitTimedOutWorkflowRuns } from "./queue-child-workflow-run-wait-timed-out-runs";
import { queueEventWaitTimedOutWorkflowRuns } from "./queue-event-wait-timed-out-runs";
import { queueRecurringWorkflows } from "./queue-recurring-workflows";
import { queueRetryableWorkflowRuns } from "./queue-retryable-runs";
import { queueWorkflowRunsWithRetryableTask } from "./queue-retryable-task-runs";
import { queueScheduledWorkflowRuns } from "./queue-scheduled-runs";
import { queueSleepElapsedWorkflowRuns } from "./queue-sleep-elapsed-runs";
import { republishStaleRuns } from "./republish-stale-runs";

export interface InitCronsDeps {
	repos: Repositories;
	workflowRunPublisher?: WorkflowRunPublisher;
	childRunCanceller: ChildRunCanceller;
	scheduleService: ScheduleService;
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
		...(deps.workflowRunPublisher
			? [
					initCron(logger, 1_000, publishReadyRuns, {
						repos: deps.repos,
						workflowRunPublisher: deps.workflowRunPublisher,
					}),
					initCron(logger, 1_000, republishStaleRuns, {
						repos: deps.repos,
						workflowRunPublisher: deps.workflowRunPublisher,
					}),
				]
			: []),
		initCron(logger, 1_000, queueScheduledWorkflowRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueSleepElapsedWorkflowRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueRetryableWorkflowRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueWorkflowRunsWithRetryableTask, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueEventWaitTimedOutWorkflowRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueChildRunWaitTimedOutWorkflowRuns, {
			repos: deps.repos,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
		initCron(logger, 1_000, queueRecurringWorkflows, {
			repos: deps.repos,
			scheduleService: deps.scheduleService,
			childRunCanceller: deps.childRunCanceller,
			workflowRunPublisher: deps.workflowRunPublisher,
		}),
	];

	return {
		shutdown() {
			for (const { abortController, interval } of crons) {
				abortController.abort();
				clearInterval(interval);
			}
		},
	};
}
