import { propsDefined, type RequiredProp } from "@aikirun/lib";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { TaskPath, TaskState } from "@aikirun/types/task";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId, WorkflowRunState, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import type { WorkflowRunStateRequest } from "@aikirun/types/workflow-run-api";
import type { Redis } from "ioredis";
import { NotFoundError, RevisionConflictError } from "server/errors";
import type { ServerContext } from "server/middleware";
import { publishWorkflowReadyBatch } from "server/redis/publisher";
import {
	assertIsValidTaskStateTransition,
	assertIsValidWorkflowRunStateTransition,
} from "server/state-machine/transitions";

import { baseImplementer } from "./base";

const os = baseImplementer.workflowRun;

const workflowRuns = new Map<WorkflowRunId, WorkflowRun>();
const workflowRunsIdempotencyMap = new Map<WorkflowId, Map<WorkflowVersionId, Map<string, WorkflowRunId>>>();
const workflowRunTransitions = new Map<WorkflowRunId, WorkflowRunTransition[]>();

const listV1 = os.listV1.handler(({ input }) => {
	const { filters, limit = 50, offset = 0, sort } = input;

	const runs: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (
			filters?.workflows &&
			isNonEmptyArray(filters.workflows) &&
			filters.workflows.every(
				(w) => (w.id && w.id !== run.workflowId) || (w.versionId && w.versionId !== run.workflowVersionId)
			)
		) {
			continue;
		}

		if (filters?.status && isNonEmptyArray(filters.status) && filters.status.every((s) => s !== run.state.status)) {
			continue;
		}

		runs.push(run);
	}

	return {
		runs: runs
			.sort((a, b) => (sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
			.slice(offset, offset + limit)
			.map((run) => ({
				id: run.id,
				workflowId: run.workflowId,
				workflowVersionId: run.workflowVersionId,
				createdAt: run.createdAt,
				status: run.state.status,
			})),
		total: runs.length,
	};
});

const getByIdV1 = os.getByIdV1.handler(({ input, context }) => {
	context.logger.info({ runId: input.id }, "Fetching workflow run by id");

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input, context }) => {
	context.logger.info({ runId: input.id }, "Fetching workflow run state");

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(({ input, context }) => {
	const workflowId = input.workflowId as WorkflowId;
	const workflowVersionId = input.workflowVersionId as WorkflowVersionId;
	const idempotencyKey = input.options?.idempotencyKey;

	context.logger.info({ workflowId, workflowVersionId }, "Creating workflow run");

	if (idempotencyKey) {
		const existingRunId = workflowRunsIdempotencyMap.get(workflowId)?.get(workflowVersionId)?.get(idempotencyKey);
		if (existingRunId) {
			context.logger.info({ runId: existingRunId, idempotencyKey }, "Returning existing run from idempotency key");
			const existingRun = workflowRuns.get(existingRunId);
			if (!existingRun) {
				throw new NotFoundError(`Workflow run not found: ${existingRunId}`);
			}
			return { run: existingRun };
		}
	}

	const now = Date.now();
	const runId = `${now}` as WorkflowRunId;

	const trigger = input.options?.trigger;

	const run: WorkflowRun = {
		id: runId,
		workflowId: workflowId,
		workflowVersionId: workflowVersionId,
		createdAt: now,
		revision: 0,
		attempts: 0,
		input: input.input,
		options: input.options ?? {},
		state: {
			status: "scheduled",
			scheduledAt:
				!trigger || trigger.type === "immediate"
					? now
					: trigger.type === "delayed"
						? "delayMs" in trigger
							? now + trigger.delayMs
							: now + toMilliseconds(trigger.delay)
						: trigger.startAt,
			reason: "new",
		},
		tasksState: {},
		sleepsState: {},
		eventsQueue: {},
		childWorkflowRuns: {},
		parentWorkflowRunId: input.parentWorkflowRunId,
	};

	workflowRuns.set(runId, run);

	if (idempotencyKey) {
		let versionMap = workflowRunsIdempotencyMap.get(workflowId);
		if (!versionMap) {
			versionMap = new Map();
			workflowRunsIdempotencyMap.set(workflowId, versionMap);
		}

		let idempotencyKeyMap = versionMap.get(workflowVersionId);
		if (!idempotencyKeyMap) {
			idempotencyKeyMap = new Map();
			versionMap.set(workflowVersionId, idempotencyKeyMap);
		}

		idempotencyKeyMap.set(idempotencyKey, runId);
	}

	return { run };
});

const transitionStateV1 = os.transitionStateV1.handler(async ({ input, context }) => {
	const runId = input.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (input.type === "optimistic" && run.revision !== input.expectedRevision) {
		throw new RevisionConflictError(runId, input.expectedRevision, run.revision);
	}

	assertIsValidWorkflowRunStateTransition(runId, run.state, input.state);

	const now = Date.now();
	const state = convertWorkflowRunStateDurationsToTimestamps(input.state, now);

	context.logger.info({ runId, state }, "Transitioning workflow run state");

	const transition: WorkflowRunTransition = {
		type: "state",
		createdAt: now,
		state,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	if (run.state.status === "sleeping" && state.status === "scheduled") {
		const sleepPath = run.state.sleepPath;
		if (state.reason === "awake") {
			run.sleepsState[sleepPath] = {
				status: "completed",
				completedAt: now,
			};
		} else {
			run.sleepsState[sleepPath] = {
				status: "cancelled",
				cancelledAt: now,
			};
		}
	}

	if (run.state.status === "paused" && state.status === "scheduled") {
		for (const [sleepPath, sleepState] of Object.entries(run.sleepsState)) {
			if (sleepState.status === "sleeping" && sleepState.awakeAt <= now) {
				run.sleepsState[sleepPath] = {
					status: "completed",
					completedAt: now,
				};
			}
		}
	}

	if (state.status === "sleeping") {
		const { sleepPath, durationMs } = state;
		const awakeAt = now + durationMs;
		run.sleepsState[sleepPath] = {
			status: "sleeping",
			awakeAt,
		};
	}

	if (
		state.status === "running" &&
		run.state.status === "queued" &&
		(run.state.reason === "retry" || run.state.reason === "new")
	) {
		run.attempts++;
	}

	run.state = state;
	run.revision++;

	if (state.status === "cancelled") {
		for (const [childRunPath, { id: childRunId }] of Object.entries(run.childWorkflowRuns)) {
			const childRun = workflowRuns.get(childRunId as WorkflowRunId);
			if (!childRun) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			await transitionStateV1.callable({ context })({
				type: "pessimistic",
				id: childRunId,
				state,
			});
			run.childWorkflowRuns[childRunPath] = { id: childRunId };
		}
	}

	if (propsDefined(run, ["parentWorkflowRunId"])) {
		await notifyParentOfStateChangeIfNecessary(context, run);
	}

	return { run };
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input, context }) => {
	const runId = input.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (run.revision !== input.expectedRevision) {
		throw new RevisionConflictError(runId, input.expectedRevision, run.revision);
	}

	const taskPath = input.taskPath as TaskPath;
	const taskStateRequest = input.taskState;

	assertIsValidTaskStateTransition(runId, taskPath, run.tasksState[taskPath] ?? { status: "none" }, taskStateRequest);

	context.logger.info({ runId, taskPath, taskState: taskStateRequest }, "Transitioning task state");

	const now = Date.now();

	const taskState: TaskState =
		taskStateRequest.status === "awaiting_retry"
			? {
					status: "awaiting_retry",
					attempts: taskStateRequest.attempts,
					error: taskStateRequest.error,
					nextAttemptAt: now + taskStateRequest.nextAttemptInMs,
				}
			: taskStateRequest;

	const transition: WorkflowRunTransition = {
		type: "task_state",
		createdAt: now,
		taskPath,
		taskState,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.tasksState[taskPath] = taskState;
	run.revision++;

	return { run };
});

const listTransitionsV1 = os.listTransitionsV1.handler(({ input }) => {
	const { id, limit = 50, offset = 0, sort } = input;

	const run = workflowRuns.get(id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${id}`);
	}

	const transitions = workflowRunTransitions.get(id as WorkflowRunId) ?? [];

	return {
		transitions: [...transitions]
			.sort((a, b) => (sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
			.slice(offset, offset + limit),
		total: transitions.length,
	};
});

async function sendEventToWorkflowRun(
	context: ServerContext,
	run: WorkflowRun<unknown, unknown>,
	receivedAt: number,
	eventId: string,
	data: unknown,
	idempotencyKey: string | undefined
): Promise<void> {
	let eventQueue = run.eventsQueue[eventId];
	if (!eventQueue) {
		eventQueue = { events: [] };
		run.eventsQueue[eventId] = eventQueue;
	}

	if (idempotencyKey) {
		const isDuplicate = eventQueue.events.some(
			(event) => event.status === "received" && event.idempotencyKey === idempotencyKey
		);
		if (isDuplicate) {
			context.logger.info({ runId: run.id, eventId, idempotencyKey }, "Duplicate event, ignoring");
			return;
		}
	}

	eventQueue.events.push({
		status: "received",
		data,
		receivedAt,
		idempotencyKey,
	});

	context.logger.info({ runId: run.id, eventId }, "Event sent to workflow run");

	if (run.state.status === "awaiting_event" && run.state.eventId === eventId) {
		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
			expectedRevision: run.revision,
		});
	}
}

async function notifyParentOfStateChangeIfNecessary(
	context: ServerContext,
	childRun: RequiredProp<WorkflowRun, "parentWorkflowRunId">
): Promise<void> {
	const parentRun = workflowRuns.get(childRun.parentWorkflowRunId as WorkflowRunId);
	if (!parentRun) {
		return;
	}

	if (
		parentRun.state.status === "awaiting_child_workflow" &&
		parentRun.state.childWorkflowRunId === childRun.id &&
		parentRun.state.childWorkflowRunStatus === childRun.state.status
	) {
		context.logger.info(
			{ parentRunId: parentRun.id, childRunId: childRun.id, status: childRun.state.status },
			"Notifying parent of child state change"
		);

		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: parentRun.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
			expectedRevision: parentRun.revision,
		});
	}
}

const sendEventV1 = os.sendEventV1.handler(async ({ input, context }) => {
	const runId = input.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const { eventId, data, options } = input;
	const idempotencyKey = options?.idempotencyKey;
	const now = Date.now();

	await sendEventToWorkflowRun(context, run, now, eventId, data, idempotencyKey);

	return { run };
});

const multicastEventV1 = os.multicastEventV1.handler(async ({ input, context }) => {
	const runIds = input.ids as WorkflowRunId[];

	const runs = runIds.map((runId) => {
		const run = workflowRuns.get(runId);
		if (!run) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return run;
	});

	const { eventId, data, options } = input;
	const idempotencyKey = options?.idempotencyKey;
	const now = Date.now();

	for (const run of runs) {
		await sendEventToWorkflowRun(context, run, now, eventId, data, idempotencyKey);
	}
});

function getWorkflowRunsWithElapsedSchedule(): WorkflowRun[] {
	const now = Date.now();
	const scheduledRuns: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "scheduled" && run.state.scheduledAt <= now) {
			scheduledRuns.push(run);
		}
	}

	return scheduledRuns;
}

// TODO: add back pressure so we do not overwhelm workers
export async function queueScheduledWorkflowRuns(context: ServerContext, redis: Redis) {
	const runs = getWorkflowRunsWithElapsedSchedule();

	// TODO: workflow state might have changed before it is queued. We might need try/catch
	for (const run of runs) {
		if (run.state.status === "scheduled") {
			await transitionStateV1.callable({ context })({
				type: "optimistic",
				id: run.id,
				state: { status: "queued", reason: run.state.reason },
				expectedRevision: run.revision,
			});
		}
	}

	if (runs.length) {
		await publishWorkflowReadyBatch(context, redis, runs);
	}
}

function getRetryableWorkflows(): WorkflowRun[] {
	const now = Date.now();
	const retryableRuns: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "awaiting_retry" && run.state.nextAttemptAt <= now) {
			retryableRuns.push(run);
		}
	}

	return retryableRuns;
}

export async function scheduleRetryableWorkflowRuns(context: ServerContext) {
	const runs = getRetryableWorkflows();

	for (const run of runs) {
		for (const [taskPath, taskState] of Object.entries(run.tasksState)) {
			if (taskState.status === "running" || taskState.status === "failed" || taskState.status === "awaiting_retry") {
				await transitionTaskStateV1.callable({ context })({
					id: run.id,
					taskPath: taskPath,
					taskState: { status: "none" },
					expectedRevision: run.revision,
				});
			} else {
				taskState.status satisfies "none" | "completed";
			}
		}

		await transitionStateV1.callable({ context })({
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

	for (const run of workflowRuns.values()) {
		if (run.state.status === "running") {
			for (const taskState of Object.values(run.tasksState)) {
				if (taskState.status === "awaiting_retry" && taskState.nextAttemptAt <= now) {
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
		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "task_retry" },
			expectedRevision: run.revision,
		});
	}
}

function getSleepingWorkflowRuns(): WorkflowRun[] {
	const now = Date.now();
	const sleepingRuns: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "sleeping") {
			const sleepState = run.sleepsState[run.state.sleepPath];
			if (sleepState?.status === "sleeping" && sleepState.awakeAt <= now) {
				sleepingRuns.push(run);
			}
		}
	}

	return sleepingRuns;
}

export async function scheduleSleepingWorkflowRuns(context: ServerContext) {
	const runs = getSleepingWorkflowRuns();

	for (const run of runs) {
		await transitionStateV1.callable({ context })({
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

	for (const run of workflowRuns.values()) {
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

		const eventId = run.state.eventId;
		const now = Date.now();

		let eventQueue = run.eventsQueue[eventId];
		if (!eventQueue) {
			eventQueue = { events: [] };
			run.eventsQueue[eventId] = eventQueue;
		}

		eventQueue.events.push({ status: "timeout", timedOutAt: now });

		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "event" },
			expectedRevision: run.revision,
		});
	}
}

function convertWorkflowRunStateDurationsToTimestamps(request: WorkflowRunStateRequest, now: number): WorkflowRunState {
	if (request.status === "scheduled" && "scheduledInMs" in request) {
		return {
			status: "scheduled",
			reason: request.reason,
			scheduledAt: now + request.scheduledInMs,
		};
	}

	if (request.status === "awaiting_retry" && "nextAttemptInMs" in request) {
		const nextAttemptAt = now + request.nextAttemptInMs;
		switch (request.cause) {
			case "task":
				return {
					status: request.status,
					cause: request.cause,
					taskPath: request.taskPath,
					nextAttemptAt,
				};
			case "child_workflow":
				return {
					status: request.status,
					cause: request.cause,
					childWorkflowRunId: request.childWorkflowRunId,
					nextAttemptAt,
				};
			case "self":
				return {
					status: request.status,
					cause: request.cause,
					error: request.error,
					nextAttemptAt,
				};
		}
	}

	if (request.status === "awaiting_event" && "timeoutInMs" in request && request.timeoutInMs !== undefined) {
		return {
			status: request.status,
			eventId: request.eventId,
			timeoutAt: now + request.timeoutInMs,
		};
	}

	return request;
}

export const workflowRunRouter = os.router({
	listV1,
	getByIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
});
