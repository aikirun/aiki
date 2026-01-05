import { propsDefined, type RequiredProp } from "@aikirun/lib";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { sha256 } from "@aikirun/lib/crypto";
import { toMilliseconds } from "@aikirun/lib/duration";
import { stableStringify } from "@aikirun/lib/json";
import { getTaskPath } from "@aikirun/lib/path";
import type { TaskId, TaskInfo, TaskName, TaskPath, TaskState } from "@aikirun/types/task";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	isTerminalWorkflowRunStatus,
	type WorkflowRun,
	type WorkflowRunId,
	type WorkflowRunState,
	type WorkflowRunTransition,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunStateRequest } from "@aikirun/types/workflow-run-api";
import type { Redis } from "ioredis";
import { NotFoundError, RevisionConflictError, ValidationError } from "server/errors";
import type { ServerContext } from "server/middleware";
import { publishWorkflowReadyBatch } from "server/redis/publisher";
import {
	assertIsValidTaskStateTransition,
	assertIsValidWorkflowRunStateTransition,
	isTaskStateTransitionToRunning,
} from "server/state-machine/transitions";

import { baseImplementer } from "./base";

const os = baseImplementer.workflowRun;

const workflowRuns = new Map<WorkflowRunId, WorkflowRun>();
const workflowRunsByReferenceId = new Map<WorkflowName, Map<WorkflowVersionId, Map<string, WorkflowRunId>>>();
const workflowRunTransitions = new Map<WorkflowRunId, WorkflowRunTransition[]>();

const listV1 = os.listV1.handler(({ input: request }) => {
	const { filters, limit = 50, offset = 0, sort } = request;

	const runs: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (
			filters?.workflows &&
			isNonEmptyArray(filters.workflows) &&
			filters.workflows.every((w) => (w.id && w.id !== run.name) || (w.versionId && w.versionId !== run.versionId))
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
				name: run.name,
				versionId: run.versionId,
				createdAt: run.createdAt,
				status: run.state.status,
			})),
		total: runs.length,
	};
});

const getByIdV1 = os.getByIdV1.handler(({ input: request, context }) => {
	context.logger.info({ runId: request.id }, "Fetching workflow run by id");

	const run = workflowRuns.get(request.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${request.id}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input: request, context }) => {
	context.logger.info({ runId: request.id }, "Fetching workflow run state");

	const run = workflowRuns.get(request.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${request.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(async ({ input: request, context }) => {
	const name = request.name as WorkflowName;
	const versionId = request.versionId as WorkflowVersionId;
	const referenceId = request.options?.reference?.id;

	context.logger.info({ name, versionId }, "Creating workflow run");

	if (referenceId) {
		const existingRunId = workflowRunsByReferenceId.get(name)?.get(versionId)?.get(referenceId);
		if (existingRunId) {
			context.logger.info({ runId: existingRunId, referenceId }, "Returning existing run from reference ID");
			const existingRun = workflowRuns.get(existingRunId);
			if (!existingRun) {
				throw new NotFoundError(`Workflow run not found: ${existingRunId}`);
			}
			return { run: existingRun };
		}
	}

	const now = Date.now();
	const runId = crypto.randomUUID() as WorkflowRunId;

	const trigger = request.options?.trigger;

	const run: WorkflowRun = {
		id: runId,
		path: request.path,
		name: name,
		versionId: versionId,
		createdAt: now,
		revision: 0,
		attempts: 0,
		input: request.input,
		options: request.options ?? {},
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
		tasks: {},
		sleepsQueue: {},
		eventsQueue: {},
		childWorkflowRuns: {},
		parentWorkflowRunId: request.parentWorkflowRunId,
	};

	workflowRuns.set(runId, run);

	if (request.parentWorkflowRunId && request.path) {
		const parentRun = workflowRuns.get(request.parentWorkflowRunId as WorkflowRunId);
		if (parentRun) {
			const inputHash = await sha256(stableStringify(request.input));
			parentRun.childWorkflowRuns[request.path] = {
				id: runId,
				inputHash,
				statusWaitResults: [],
			};
		}
	}

	if (referenceId) {
		let versionMap = workflowRunsByReferenceId.get(name);
		if (!versionMap) {
			versionMap = new Map();
			workflowRunsByReferenceId.set(name, versionMap);
		}

		let referenceIdMap = versionMap.get(versionId);
		if (!referenceIdMap) {
			referenceIdMap = new Map();
			versionMap.set(versionId, referenceIdMap);
		}

		referenceIdMap.set(referenceId, runId);
	}

	return { run };
});

const transitionStateV1 = os.transitionStateV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (request.type === "optimistic" && run.revision !== request.expectedRevision) {
		throw new RevisionConflictError(runId, request.expectedRevision, run.revision);
	}

	assertIsValidWorkflowRunStateTransition(runId, run.state, request.state);

	const now = Date.now();
	let state = convertWorkflowRunStateDurationsToTimestamps(request.state, now);

	context.logger.info({ runId, state }, "Transitioning workflow run state");

	const transitions = workflowRunTransitions.get(runId) ?? [];

	if (run.state.status === "sleeping" && state.status === "scheduled") {
		const sleepQueue = run.sleepsQueue[run.state.sleepId];
		if (sleepQueue && isNonEmptyArray(sleepQueue.sleeps)) {
			if (state.reason === "awake") {
				const startedSleepingAt = transitions[transitions.length - 1]?.createdAt;
				sleepQueue.sleeps[sleepQueue.sleeps.length - 1] = {
					status: "completed",
					durationMs: startedSleepingAt ? now - startedSleepingAt : run.state.durationMs,
					completedAt: now,
				};
			} else {
				sleepQueue.sleeps[sleepQueue.sleeps.length - 1] = {
					status: "cancelled",
					cancelledAt: now,
				};
			}
		}
	}

	if (state.status === "sleeping") {
		const { sleepId, durationMs } = state;
		const awakeAt = now + durationMs;
		const sleepQueue = run.sleepsQueue[sleepId];
		if (sleepQueue?.sleeps) {
			sleepQueue.sleeps.push({ status: "sleeping", awakeAt });
		} else {
			run.sleepsQueue[sleepId] = {
				sleeps: [{ status: "sleeping", awakeAt }],
			};
		}
	}

	if (
		state.status === "running" &&
		run.state.status === "queued" &&
		(run.state.reason === "retry" || run.state.reason === "new")
	) {
		run.attempts++;
	}

	if (state.status === "scheduled" && state.reason === "retry") {
		for (const [taskPath, taskInfo] of Object.entries(run.tasks)) {
			if (
				taskInfo.state.status === "running" ||
				taskInfo.state.status === "awaiting_retry" ||
				taskInfo.state.status === "failed"
			) {
				delete run.tasks[taskPath];
			} else {
				taskInfo.state.status satisfies "completed";
			}
		}
	}

	if (state.status === "awaiting_child_workflow") {
		const childPath = state.childWorkflowRunPath;
		const childRunId = run.childWorkflowRuns[childPath]?.id;

		if (childRunId) {
			const childRun = workflowRuns.get(childRunId as WorkflowRunId);
			if (childRun) {
				const childStatus = childRun.state.status;
				const expectedStatus = state.childWorkflowRunStatus;

				if (childStatus === expectedStatus || isTerminalWorkflowRunStatus(childStatus)) {
					const statusWaitResults = run.childWorkflowRuns[childPath]?.statusWaitResults;
					if (statusWaitResults) {
						statusWaitResults.push({
							status: "completed",
							completedAt: now,
							childWorkflowRunState: childRun.state,
						});
					}

					state = { status: "scheduled", scheduledAt: now, reason: "child_workflow" };
					context.logger.info({ runId, childPath, childStatus }, "Child already at status, scheduling immediately");
				}
			}
		}
	}

	const transition: WorkflowRunTransition = {
		type: "state",
		createdAt: now,
		state,
	};
	if (!transitions.length) {
		transitions.push(transition);
		workflowRunTransitions.set(runId, transitions);
	} else {
		transitions.push(transition);
	}

	run.state = state;
	run.revision++;

	if (state.status === "cancelled") {
		for (const [childRunPath, childRunInfo] of Object.entries(run.childWorkflowRuns)) {
			const childRun = workflowRuns.get(childRunInfo.id as WorkflowRunId);
			if (!childRun) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			await transitionStateV1.callable({ context })({
				type: "pessimistic",
				id: childRunInfo.id,
				state,
			});
			run.childWorkflowRuns[childRunPath] = {
				id: childRunInfo.id,
				inputHash: childRunInfo.inputHash,
				statusWaitResults: [],
			};
		}
	}

	if (propsDefined(run, ["path", "parentWorkflowRunId"])) {
		await notifyParentOfStateChangeIfNecessary(context, run);
	}

	return { run };
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (run.revision !== request.expectedRevision) {
		throw new RevisionConflictError(runId, request.expectedRevision, run.revision);
	}

	let inputHash: string;
	let taskName: TaskName;
	let taskPath: TaskPath;
	let taskId: TaskId;
	let existingTaskState: TaskState | undefined;
	let taskState: TaskState;
	const now = Date.now();

	if (isTaskStateTransitionToRunning(request) && request.type === "create") {
		inputHash = await sha256(stableStringify(request.taskState.input));
		taskName = request.taskName as TaskName;
		taskPath = getTaskPath(taskName, request.options?.reference?.id ?? inputHash);

		const existingTaskInfo = run.tasks[taskPath];
		if (existingTaskInfo) {
			throw new ValidationError(`Task ${taskPath} already exists. Use type: "retry" to retry it.`);
		}

		taskId = crypto.randomUUID() as TaskId;
		taskState = request.taskState;
	} else {
		const existingTaskInfo = findTaskById(run, request.taskId as TaskId);
		if (!existingTaskInfo) {
			throw new NotFoundError(`Task not found: ${request.taskId}`);
		}

		inputHash = existingTaskInfo.inputHash;
		taskName = existingTaskInfo.name as TaskName;
		taskPath = existingTaskInfo.path;
		taskId = existingTaskInfo.id as TaskId;

		existingTaskState = existingTaskInfo.state;
		taskState =
			request.taskState.status === "awaiting_retry"
				? {
						status: "awaiting_retry",
						attempts: request.taskState.attempts,
						error: request.taskState.error,
						nextAttemptAt: now + request.taskState.nextAttemptInMs,
					}
				: request.taskState;
	}

	assertIsValidTaskStateTransition(runId, taskName, taskId, existingTaskState?.status, taskState.status);

	context.logger.info({ runId, taskId, taskState }, "Transitioning task state");

	const transition: WorkflowRunTransition = {
		type: "task_state",
		createdAt: now,
		taskId,
		taskState,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.tasks[taskPath] = { id: taskId, name: taskName, state: taskState, inputHash };
	run.revision++;

	return { run, taskId };
});

const setTaskStateV1 = os.setTaskStateV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const now = Date.now();

	if (request.type === "new") {
		const inputHash = await sha256(stableStringify(request.input));
		const taskPath = getTaskPath(request.taskName, request.reference?.id ?? inputHash);

		const existingTaskInfo = run.tasks[taskPath];
		if (existingTaskInfo) {
			throw new ValidationError(`Task ${taskPath} already exists. Use type: "existing" to update it.`);
		}

		const taskId = crypto.randomUUID();

		context.logger.info({ runId, taskId, state: request.state }, "Setting task state (new task)");

		const runningState: TaskState = {
			status: "running",
			attempts: 1,
			input: request.input,
		};

		const runningTransition: WorkflowRunTransition = {
			type: "task_state",
			createdAt: now,
			taskId,
			taskState: runningState,
		};

		const finalState: TaskState =
			request.state.status === "completed"
				? { status: "completed", attempts: 1, output: request.state.output }
				: { status: request.state.status satisfies "failed", attempts: 1, error: request.state.error };

		const finalTransition: WorkflowRunTransition = {
			type: "task_state",
			createdAt: now,
			taskId,
			taskState: finalState,
		};

		const transitions = workflowRunTransitions.get(runId);
		if (!transitions) {
			workflowRunTransitions.set(runId, [runningTransition, finalTransition]);
		} else {
			transitions.push(runningTransition, finalTransition);
		}

		run.tasks[taskPath] = { id: taskId, name: request.taskName, state: finalState, inputHash };
		run.revision++;

		return { run };
	}

	const existingTaskInfo = findTaskById(run, request.taskId as TaskId);
	if (!existingTaskInfo) {
		throw new NotFoundError(`Task not found: ${request.taskId}`);
	}

	context.logger.info({ runId, taskId: request.taskId, state: request.state }, "Setting task state (existing task)");

	const attempts = existingTaskInfo.state.attempts;

	const finalState: TaskState =
		request.state.status === "completed"
			? { status: "completed", attempts: attempts + 1, output: request.state.output }
			: { status: request.state.status satisfies "failed", attempts: attempts + 1, error: request.state.error };

	const finalTransition: WorkflowRunTransition = {
		type: "task_state",
		createdAt: now,
		taskId: existingTaskInfo.id,
		taskState: finalState,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [finalTransition]);
	} else {
		transitions.push(finalTransition);
	}

	run.tasks[existingTaskInfo.path] = {
		id: existingTaskInfo.id,
		name: existingTaskInfo.name,
		state: finalState,
		inputHash: existingTaskInfo.inputHash,
	};
	run.revision++;

	return { run };
});

function findTaskById(run: WorkflowRun, taskId: TaskId): (TaskInfo & { path: TaskPath }) | undefined {
	for (const [path, info] of Object.entries(run.tasks)) {
		if (info.id === taskId) {
			return {
				...info,
				path: path as TaskPath,
			};
		}
	}
	return undefined;
}

const listTransitionsV1 = os.listTransitionsV1.handler(({ input: request }) => {
	const { id, limit = 50, offset = 0, sort } = request;

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
	childRun: RequiredProp<WorkflowRun, "path" | "parentWorkflowRunId">
): Promise<void> {
	const parentRun = workflowRuns.get(childRun.parentWorkflowRunId as WorkflowRunId);
	if (!parentRun) {
		return;
	}

	if (
		parentRun.state.status === "awaiting_child_workflow" &&
		parentRun.state.childWorkflowRunPath === childRun.path &&
		parentRun.state.childWorkflowRunStatus === childRun.state.status
	) {
		context.logger.info(
			{ parentRunId: parentRun.id, childRunId: childRun.id, status: childRun.state.status },
			"Notifying parent of child state change"
		);

		const statusWaitResults = parentRun.childWorkflowRuns[childRun.path]?.statusWaitResults;
		if (statusWaitResults) {
			statusWaitResults.push({
				status: "completed",
				completedAt: Date.now(),
				childWorkflowRunState: childRun.state,
			});
		}

		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: parentRun.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
			expectedRevision: parentRun.revision,
		});
	}
}

const sendEventV1 = os.sendEventV1.handler(async ({ input: request, context }) => {
	const runId = request.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const { eventId, data, options } = request;
	const idempotencyKey = options?.idempotencyKey;
	const now = Date.now();

	await sendEventToWorkflowRun(context, run, now, eventId, data, idempotencyKey);

	return { run };
});

const multicastEventV1 = os.multicastEventV1.handler(async ({ input: request, context }) => {
	const runIds = request.ids as WorkflowRunId[];

	const runs = runIds.map((runId) => {
		const run = workflowRuns.get(runId);
		if (!run) {
			throw new NotFoundError(`Workflow run not found: ${runId}`);
		}
		return run;
	});

	const { eventId, data, options } = request;
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
		await transitionStateV1.callable({ context })({
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

	for (const run of workflowRuns.values()) {
		if (run.state.status === "sleeping") {
			const sleepQueue = run.sleepsQueue[run.state.sleepId];
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
		await transitionStateV1.callable({ context })({
			type: "pessimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "awake" },
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

function getWorkflowRunsThatTimedOutWaitingForChild(): WorkflowRun[] {
	const now = Date.now();
	const workflowRunsThatTimedoutWaitingForChild: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
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

		const statusWaitResults = run.childWorkflowRuns[run.state.childWorkflowRunPath]?.statusWaitResults;
		if (statusWaitResults) {
			statusWaitResults.push({ status: "timeout", timedOutAt: now });
		}

		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledInMs: 0, reason: "child_workflow" },
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
					taskId: request.taskId,
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

	if (request.status === "awaiting_child_workflow" && "timeoutInMs" in request && request.timeoutInMs !== undefined) {
		return {
			status: request.status,
			childWorkflowRunPath: request.childWorkflowRunPath,
			childWorkflowRunStatus: request.childWorkflowRunStatus,
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
	setTaskStateV1,
	listTransitionsV1,
	sendEventV1,
	multicastEventV1,
});
