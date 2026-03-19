import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { CronContext } from "server/middleware/context";
import { createCronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import type { ScheduleService } from "server/service/schedule";

import { publishReadyRuns } from "./publish-ready-runs";
import { queueScheduledWorkflowRuns } from "./queue-scheduled-runs";
import { republishStaleRuns } from "./republish-stale-runs";
import { scheduleChildRunWaitTimedOutWorkflowRuns } from "./schedule-child-workflow-run-wait-timed-out-runs";
import { scheduleEventWaitTimedOutWorkflowRuns } from "./schedule-event-wait-timed-out-runs";
import { scheduleRecurringWorkflows } from "./schedule-recurring-workflows";
import { scheduleRetryableWorkflowRuns } from "./schedule-retryable-runs";
import { scheduleWorkflowRunsWithRetryableTask } from "./schedule-retryable-task-runs";
import { scheduleSleepElapsedWorkflowRuns } from "./schedule-sleep-elapsed-runs";

export interface InitCronsDeps {
	repos: Repositories;
	workflowRunPublisher?: WorkflowRunPublisher;
	childRunCanceller: ChildRunCanceller;
	scheduleService: ScheduleService;
}

export interface CronHandle {
	shutdown(): void;
}

function initCron<Deps, Opts>(
	logger: Logger,
	intervalMs: number,
	fn: (context: CronContext, deps: Deps, opts?: Opts) => Promise<void>,
	deps: Deps,
	opts?: Opts
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
		fn(context, deps, opts)
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
	const publisherDeps = deps.workflowRunPublisher
		? { repos: deps.repos, workflowRunPublisher: deps.workflowRunPublisher }
		: undefined;

	const crons = [
		...(publisherDeps
			? [
					initCron(logger, 500, publishReadyRuns, publisherDeps),
					initCron(logger, 500, republishStaleRuns, publisherDeps),
				]
			: []),
		initCron(logger, 500, queueScheduledWorkflowRuns, { repos: deps.repos }),
		initCron(logger, 500, scheduleSleepElapsedWorkflowRuns, { repos: deps.repos }),
		initCron(logger, 500, scheduleRetryableWorkflowRuns, { repos: deps.repos }),
		initCron(logger, 500, scheduleWorkflowRunsWithRetryableTask, { repos: deps.repos }),
		initCron(logger, 500, scheduleEventWaitTimedOutWorkflowRuns, { repos: deps.repos }),
		initCron(logger, 500, scheduleChildRunWaitTimedOutWorkflowRuns, { repos: deps.repos }),
		initCron(logger, 500, scheduleRecurringWorkflows, {
			repos: deps.repos,
			scheduleService: deps.scheduleService,
			childRunCanceller: deps.childRunCanceller,
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
