import { groupBy, isNonEmptyArray } from "@aikirun/lib/array";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";
import type { Repositories } from "server/infra/db/types";
import type { WorkflowRunPublisher } from "server/infra/messaging/redis-publisher";
import type { TimerSortedSet, TimerType } from "server/infra/messaging/redis-timer-sorted-set";
import type { CronContext } from "server/middleware/context";
import type { ChildRunCanceller } from "server/service/cancel-child-runs";
import { scheduleRowToDomain } from "server/service/schedule";

import { queueChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { type DueSchedule, queueRecurringWorkflows } from "./imminent-recurring-workflows";
import { queueRetryableRuns } from "./imminent-retryable-runs";
import { queueRetryableTaskRuns } from "./imminent-retryable-task-runs";
import { queueScheduledRuns } from "./imminent-scheduled-runs";
import { queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";

export interface QueueDueTimersDeps {
	repos: Repositories;
	timerSortedSet: TimerSortedSet;
	childRunCanceller: ChildRunCanceller;
	workflowRunPublisher?: WorkflowRunPublisher;
}

export async function queueDueTimers(context: CronContext, deps: QueueDueTimersDeps, options?: { limit?: number }) {
	const { limit = 100 } = options ?? {};

	const dueTimers = await deps.timerSortedSet.popDue(Date.now(), limit);
	if (dueTimers.length === 0) {
		return;
	}

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
			const runs = await deps.repos.workflowRun.listByIdsAndStatus(ids, runStatus);
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
