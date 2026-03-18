import type { DatabaseConn } from "server/infra/db";
import type { ChildWorkflowRunWaitQueueRepository } from "server/infra/db/repository/child-workflow-run-wait-queue";
import type { EventWaitQueueRepository } from "server/infra/db/repository/event-wait-queue";
import type { ScheduleRepository } from "server/infra/db/repository/schedule";
import type { SleepQueueRepository } from "server/infra/db/repository/sleep-queue";
import type { StateTransitionRepository } from "server/infra/db/repository/state-transition";
import type { TaskRepository } from "server/infra/db/repository/task";
import type { WorkflowRepository } from "server/infra/db/repository/workflow";
import type { WorkflowRunRepository } from "server/infra/db/repository/workflow-run";
import type { WorkflowRunOutboxRepository } from "server/infra/db/repository/workflow-run-outbox";
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
	db: DatabaseConn;
	workflowRunPublisher?: WorkflowRunPublisher;
	workflowRunOutboxRepo: WorkflowRunOutboxRepository;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	sleepQueueRepo: SleepQueueRepository;
	taskRepo: TaskRepository;
	workflowRepo: WorkflowRepository;
	scheduleRepo: ScheduleRepository;
	eventWaitQueueRepo: EventWaitQueueRepository;
	childWorkflowRunWaitQueueRepo: ChildWorkflowRunWaitQueueRepository;
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
		? { workflowRunOutboxRepo: deps.workflowRunOutboxRepo, workflowRunPublisher: deps.workflowRunPublisher }
		: undefined;

	const crons = [
		...(publisherDeps
			? [
					initCron(logger, 500, publishReadyRuns, publisherDeps),
					initCron(logger, 500, republishStaleRuns, publisherDeps),
				]
			: []),
		initCron(logger, 500, queueScheduledWorkflowRuns, deps),
		initCron(logger, 500, scheduleSleepElapsedWorkflowRuns, deps),
		initCron(logger, 500, scheduleRetryableWorkflowRuns, deps),
		initCron(logger, 500, scheduleWorkflowRunsWithRetryableTask, deps),
		initCron(logger, 500, scheduleEventWaitTimedOutWorkflowRuns, deps),
		initCron(logger, 500, scheduleChildRunWaitTimedOutWorkflowRuns, deps),
		initCron(logger, 500, scheduleRecurringWorkflows, deps),
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
