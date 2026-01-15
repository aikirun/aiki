import { isNonEmptyArray } from "@aikirun/lib";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
import type { Redis } from "ioredis";
import { publishWorkflowRunReadyBatch } from "server/infrastructure/messaging/redis-publisher";
import { workflowRunsById } from "server/infrastructure/persistence/in-memory-store";
import type { ServerContext } from "server/middleware";
import {
	findActiveRunForSchedule,
	getDueOccurrences,
	getDueSchedules,
	getNextOccurrence,
	getReferenceId,
	updateSchedule,
} from "server/services/schedule";
import { createWorkflowRun } from "server/services/workflow-run";
import { transitionWorkflowRunState } from "server/services/workflow-run-state-machine";

function getWorkflowRunsWithElapsedSchedule(): WorkflowRun[] {
	const now = Date.now();
	const scheduledRuns: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (run.state.status === "scheduled" && run.state.scheduledAt <= now) {
			scheduledRuns.push(run);
		}
	}

	return scheduledRuns;
}

// TODO:
// 		- add back pressure so we do not overwhelm workers
// 		- ensure db update and event publish are atomic
export async function queueScheduledWorkflowRuns(context: ServerContext, redis: Redis) {
	const runs = getWorkflowRunsWithElapsedSchedule();

	for (const run of runs) {
		if (run.state.status === "scheduled") {
			await transitionWorkflowRunState(context, {
				type: "optimistic",
				id: run.id,
				state: { status: "queued", reason: run.state.reason },
				expectedRevision: run.revision,
			});
		}
	}

	if (runs.length) {
		await publishWorkflowRunReadyBatch(context, redis, runs);
	}
}

function getRetryableWorkflows(): WorkflowRun[] {
	const now = Date.now();
	const retryableRuns: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (run.state.status === "awaiting_retry" && run.state.nextAttemptAt <= now) {
			retryableRuns.push(run);
		}
	}

	return retryableRuns;
}

export async function scheduleRetryableWorkflowRuns(context: ServerContext) {
	const runs = getRetryableWorkflows();

	for (const run of runs) {
		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "retry" },
			expectedRevision: run.revision,
		});
	}
}

function getWorkflowRunsWithRetryableTask(): WorkflowRun[] {
	const now = Date.now();
	const runsWithRetryableTask: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (run.state.status === "running") {
			for (const taskInfo of Object.values(run.tasks)) {
				if (taskInfo.state.status === "awaiting_retry" && taskInfo.state.nextAttemptAt <= now) {
					runsWithRetryableTask.push(run);
				}
			}
		}
	}

	return runsWithRetryableTask;
}

export async function scheduleWorkflowRunsWithRetryableTask(context: ServerContext) {
	const runs = getWorkflowRunsWithRetryableTask();

	for (const run of runs) {
		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "task_retry" },
			expectedRevision: run.revision,
		});
	}
}

function getSleepingElapsedWorkflowRuns(): WorkflowRun[] {
	const now = Date.now();
	const sleepingRuns: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (run.state.status === "sleeping") {
			const sleepQueue = run.sleepsQueue[run.state.sleepName];
			const lastSleep = sleepQueue?.sleeps[sleepQueue.sleeps.length - 1];
			if (lastSleep?.status === "sleeping" && lastSleep.awakeAt <= now) {
				sleepingRuns.push(run);
			}
		}
	}

	return sleepingRuns;
}

export async function scheduleSleepingElapedWorkflowRuns(context: ServerContext) {
	const runs = getSleepingElapsedWorkflowRuns();

	for (const run of runs) {
		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "awake" },
			expectedRevision: run.revision,
		});
	}
}

function getEventWaitTimedOutWorkflowRuns(): WorkflowRun[] {
	const now = Date.now();
	const eventWaitTimedOutRuns: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (run.state.status === "awaiting_event" && run.state.timeoutAt !== undefined && run.state.timeoutAt <= now) {
			eventWaitTimedOutRuns.push(run);
		}
	}

	return eventWaitTimedOutRuns;
}

export async function scheduleEventWaitTimedOutWorkflowRuns(context: ServerContext) {
	const runs = getEventWaitTimedOutWorkflowRuns();

	for (const run of runs) {
		if (run.state.status !== "awaiting_event") {
			continue;
		}

		const eventName = run.state.eventName;
		const now = Date.now();

		let eventQueue = run.eventsQueue[eventName];
		if (!eventQueue) {
			eventQueue = { events: [] };
			run.eventsQueue[eventName] = eventQueue;
		}

		eventQueue.events.push({ status: "timeout", timedOutAt: now });

		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
			expectedRevision: run.revision,
		});
	}
}

function getWorkflowRunsThatTimedOutWaitingForChild(): WorkflowRun[] {
	const now = Date.now();
	const workflowRunsThatTimedoutWaitingForChild: WorkflowRun[] = [];

	for (const run of workflowRunsById.values()) {
		if (
			run.state.status === "awaiting_child_workflow" &&
			run.state.timeoutAt !== undefined &&
			run.state.timeoutAt <= now
		) {
			workflowRunsThatTimedoutWaitingForChild.push(run);
		}
	}

	return workflowRunsThatTimedoutWaitingForChild;
}

export async function scheduleWorkflowRunsThatTimedOutWaitingForChild(context: ServerContext) {
	const runs = getWorkflowRunsThatTimedOutWaitingForChild();
	const now = Date.now();

	for (const run of runs) {
		if (run.state.status !== "awaiting_child_workflow") {
			continue;
		}

		const childRun = workflowRunsById.get(run.state.childWorkflowRunId as WorkflowRunId);
		if (!childRun) {
			continue;
		}

		const statusWaitResults = run.childWorkflowRuns[childRun.address]?.statusWaitResults;
		if (statusWaitResults) {
			statusWaitResults.push({ status: "timeout", timedOutAt: now });
		}

		await transitionWorkflowRunState(context, {
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
			expectedRevision: run.revision,
		});
	}
}

export async function scheduleRecurringWorkflows(context: ServerContext) {
	const now = Date.now();
	const dueSchedules = getDueSchedules(now);

	for (const schedule of dueSchedules) {
		const occurrences = getDueOccurrences(schedule, now);
		if (!isNonEmptyArray(occurrences)) {
			continue;
		}

		const overlapPolicy = schedule.spec.overlapPolicy ?? "skip";

		if (overlapPolicy === "allow") {
			for (const occurrence of occurrences) {
				await createWorkflowRun(context, {
					name: schedule.workflowName,
					versionId: schedule.workflowVersionId,
					input: schedule.input,
					options: {
						reference: { id: getReferenceId(schedule.id, occurrence) },
					},
				});
			}

			// biome-ignore lint/style/noNonNullAssertion: index exists
			const lastOccurrence = occurrences[occurrences.length - 1]!;
			updateSchedule(schedule.id, {
				lastOccurrence,
				nextRunAt: getNextOccurrence(schedule.spec, lastOccurrence),
				runCount: schedule.runCount + occurrences.length,
				updatedAt: now,
			});
			continue;
		}

		// skip and cancel_previous return a single occurrence
		const occurrence = occurrences[0];
		const activeRun = findActiveRunForSchedule(schedule);

		if (activeRun && overlapPolicy === "skip") {
			// Update nextRunAt so we don't keep picking up this schedule as due,
			// but keep lastOccurrence unchanged so findActiveRunForSchedule can still find the active run
			updateSchedule(schedule.id, {
				nextRunAt: getNextOccurrence(schedule.spec, occurrence),
				updatedAt: now,
			});
			continue;
		}

		if (activeRun && overlapPolicy === "cancel_previous") {
			await transitionWorkflowRunState(context, {
				type: "pessimistic",
				id: activeRun.id,
				state: { status: "cancelled", reason: "Schedule overlap policy" },
			});
		}

		await createWorkflowRun(context, {
			name: schedule.workflowName,
			versionId: schedule.workflowVersionId,
			input: schedule.input,
			options: {
				reference: { id: getReferenceId(schedule.id, occurrence) },
			},
		});

		updateSchedule(schedule.id, {
			lastOccurrence: occurrence,
			nextRunAt: getNextOccurrence(schedule.spec, occurrence),
			runCount: schedule.runCount + 1,
			updatedAt: now,
		});
	}
}
