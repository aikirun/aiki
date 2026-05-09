import { groupBy, isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { Repositories } from "server/infra/db/types";
import type { Logger } from "server/infra/logger";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerSortedSet, TimerType } from "server/infra/messaging/redis-timer-sorted-set";
import type { CronContext } from "server/middleware/context";
import { createCronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import { scheduleRowToDomain } from "server/service/schedule";

import { queueChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { type DueSchedule, queueRecurringWorkflows } from "./imminent-recurring-workflows";
import { queueRetryableRuns } from "./imminent-retryable-runs";
import { queueRetryableTaskRuns } from "./imminent-retryable-task-runs";
import { queueScheduledRuns } from "./imminent-scheduled-runs";
import { queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";

export interface DueTimersConsumerDeps {
	repos: Repositories;
	timerSortedSet: TimerSortedSet;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: WorkflowRunPublisher;
}

export interface DueTimersConsumerOptions {
	limit?: number;
	overshootMs?: number;
}

export interface DueTimersConsumerHandle {
	stop(): void;
}

export function spawnDueTimersConsumer(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	options?: DueTimersConsumerOptions
): DueTimersConsumerHandle {
	const abortController = new AbortController();
	const { signal: abortSignal } = abortController;

	dueTimersConsumerLoop(logger, deps, abortSignal, options).catch((error) => {
		if (!abortSignal.aborted) {
			logger.error({ error }, "Due timers consumer crashed unexpectedly");
		}
	});

	return {
		stop() {
			abortController.abort();
		},
	};
}

async function dueTimersConsumerLoop(
	logger: Logger,
	deps: DueTimersConsumerDeps,
	abortSignal: AbortSignal,
	options?: DueTimersConsumerOptions
): Promise<void> {
	const { limit = 100, overshootMs = 30 } = options ?? {};

	// Peek on startup to discover any entries left over from a previous consumer's lifecycle.
	let nextTimerDueAt = await deps.timerSortedSet.peek();

	while (!abortSignal.aborted) {
		let signal = 0;

		if (nextTimerDueAt === null) {
			signal = await deps.timerSortedSet.waitForSignal(0);
		} else {
			const waitMs = nextTimerDueAt - Date.now() + overshootMs;
			if (waitMs > 0) {
				signal = await deps.timerSortedSet.waitForSignal(waitMs / 1000);
			}
		}

		if (abortSignal.aborted) {
			break;
		}

		if (signal > Date.now()) {
			if (nextTimerDueAt === null || signal < nextTimerDueAt) {
				nextTimerDueAt = signal;
			}
			continue;
		}

		const context = createCronContext({ name: "dueTimersConsumer", logger, signal: abortSignal });

		try {
			let hasDueTimers = true;
			while (hasDueTimers && !abortSignal.aborted) {
				const dueTimers = await deps.timerSortedSet.popDue(Date.now(), limit);
				if (isNonEmptyArray(dueTimers)) {
					await processDueTimers(context, deps, dueTimers);
				}
				hasDueTimers = dueTimers.length >= limit;
			}
		} catch (error) {
			context.logger.error({ error }, "Failed to process due timers batch");
		}

		nextTimerDueAt = await deps.timerSortedSet.peek();
	}
}

async function processDueTimers(
	context: CronContext,
	deps: DueTimersConsumerDeps,
	dueTimers: NonEmptyArray<{ type: TimerType; id: string }>
): Promise<void> {
	const timersByType = groupBy(dueTimers, (timer) => [timer.type, timer.id]);

	const promises: Promise<void>[] = [];

	for (const [timerType, ids] of timersByType) {
		if (timerType === "recurring") {
			const rows = await deps.repos.schedule.listActiveByIds(context, ids);
			const schedules: DueSchedule[] = rows.map(({ schedule, workflow }) => ({
				...scheduleRowToDomain(schedule, workflow),
				workflowId: schedule.workflowId,
				namespaceId: schedule.namespaceId as NamespaceId,
				workflowRunInputHash: schedule.workflowRunInputHash,
			}));
			if (!isNonEmptyArray(schedules)) {
				continue;
			}
			promises.push(queueRecurringWorkflows(context, deps, schedules));
		} else {
			const runStatus = timerTypeToWorkflowRunStatus[timerType];
			const runs = await deps.repos.workflowRun.listByIdsAndStatus(context, ids, runStatus);
			if (!isNonEmptyArray(runs)) {
				continue;
			}

			switch (timerType) {
				case "sleep": {
					promises.push(queueSleepElapsedRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				case "retry": {
					promises.push(queueRetryableRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				case "task_retry": {
					promises.push(queueRetryableTaskRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				case "event_wait_timeout": {
					promises.push(queueEventWaitTimedOutRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				case "child_wait_timeout": {
					promises.push(queueChildRunWaitTimedOutRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				case "scheduled": {
					promises.push(queueScheduledRuns(context, deps.repos, deps.workflowRunPublisher, runs));
					break;
				}
				default: {
					timerType satisfies never;
				}
			}
		}
	}

	await Promise.all(promises);
}

const timerTypeToWorkflowRunStatus: Record<Exclude<TimerType, "recurring">, WorkflowRunStatus> = {
	sleep: "sleeping",
	retry: "awaiting_retry",
	task_retry: "running",
	event_wait_timeout: "awaiting_event",
	child_wait_timeout: "awaiting_child_workflow",
	scheduled: "scheduled",
};
