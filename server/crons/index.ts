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
import type { ScheduleService } from "server/service/schedule";

import { publishReadyRuns } from "./publish-ready-runs";
import { queueScheduledWorkflowRuns } from "./queue-scheduled-runs";
import { scheduleChildRunWaitTimedOutWorkflowRuns } from "./schedule-child-workflow-run-wait-timed-out-runs";
import { scheduleEventWaitTimedOutWorkflowRuns } from "./schedule-event-wait-timed-out-runs";
import { scheduleRecurringWorkflows } from "./schedule-recurring-workflows";
import { scheduleRetryableWorkflowRuns } from "./schedule-retryable-runs";
import { scheduleWorkflowRunsWithRetryableTask } from "./schedule-retryable-task-runs";
import { scheduleSleepElapsedWorkflowRuns } from "./schedule-sleep-elapsed-runs";

export interface InitCronsDeps {
	db: DatabaseConn;
	workflowRunPublisher: WorkflowRunPublisher;
	workflowRunOutboxRepo: WorkflowRunOutboxRepository;
	workflowRunRepo: WorkflowRunRepository;
	stateTransitionRepo: StateTransitionRepository;
	sleepQueueRepo: SleepQueueRepository;
	taskRepo: TaskRepository;
	workflowRepo: WorkflowRepository;
	scheduleRepo: ScheduleRepository;
	eventWaitQueueRepo: EventWaitQueueRepository;
	childWorkflowRunWaitQueueRepo: ChildWorkflowRunWaitQueueRepository;
	scheduleService: ScheduleService;
}

export interface CronHandle {
	shutdown(): void;
}

function initCron(
	logger: Logger,
	fn: (context: CronContext) => Promise<void>,
	intervalMs: number
): {
	interval: ReturnType<typeof setInterval>;
	abortController: AbortController;
} {
	const abortController = new AbortController();
	const { signal } = abortController;

	let running = false;

	const interval = setInterval(() => {
		if (signal.aborted || running) {
			return;
		}
		running = true;

		const context = createCronContext({ name: fn.name, logger, signal });
		const start = performance.now();
		fn(context)
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
		initCron(logger, (context) => publishReadyRuns(context, deps), 500),
		initCron(logger, (context) => queueScheduledWorkflowRuns(context, deps), 500),
		initCron(logger, (context) => scheduleSleepElapsedWorkflowRuns(context, deps), 500),
		initCron(logger, (context) => scheduleRetryableWorkflowRuns(context, deps), 500),
		initCron(logger, (context) => scheduleWorkflowRunsWithRetryableTask(context, deps), 500),
		initCron(logger, (context) => scheduleEventWaitTimedOutWorkflowRuns(context, deps), 500),
		initCron(logger, (context) => scheduleChildRunWaitTimedOutWorkflowRuns(context, deps), 500),
		initCron(logger, (context) => scheduleRecurringWorkflows(context, deps), 500),
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
