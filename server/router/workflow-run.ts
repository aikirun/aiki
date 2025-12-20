import { isNonEmptyArray } from "@aikirun/lib/array";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { TaskPath } from "@aikirun/types/task";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";
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

	const runs: WorkflowRun<unknown, unknown>[] = [];

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
	context.logger.info(
		{
			workflowRunId: input.id,
		},
		"Fetching workflow run by id"
	);

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input, context }) => {
	context.logger.info(
		{
			workflowRunId: input.id,
		},
		"Fetching workflow run state"
	);

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(({ input, context }) => {
	context.logger.info(
		{
			workflowId: input.workflowId,
			workflowVersionId: input.workflowVersionId,
		},
		"Creating workflow run"
	);

	const workflowId = input.workflowId as WorkflowId;
	const workflowVersionId = input.workflowVersionId as WorkflowVersionId;
	const idempotencyKey = input.options?.idempotencyKey;

	if (idempotencyKey) {
		const existingRunId = workflowRunsIdempotencyMap.get(workflowId)?.get(workflowVersionId)?.get(idempotencyKey);
		if (existingRunId) {
			context.logger.info(
				{
					workflowRunId: existingRunId,
					idempotencyKey,
				},
				"Returning existing run from idempotency key"
			);
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
		workflowId: input.workflowId,
		workflowVersionId: input.workflowVersionId,
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
		childWorkflowsRunState: {},
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

	context.logger.info(
		{
			workflowRunId: runId,
			state: input.state,
		},
		"Transitioning workflow run state"
	);

	const now = Date.now();

	const transition: WorkflowRunTransition = {
		type: "state",
		createdAt: now,
		state: input.state,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	if (run.state.status === "sleeping" && input.state.status === "scheduled") {
		const sleepPath = run.state.sleepPath;
		if (input.state.reason === "awake") {
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

	if (run.state.status === "paused" && input.state.status === "scheduled") {
		for (const [sleepPath, sleepState] of Object.entries(run.sleepsState)) {
			if (sleepState.status === "sleeping" && sleepState.awakeAt <= now) {
				run.sleepsState[sleepPath] = {
					status: "completed",
					completedAt: now,
				};
			}
		}
	}

	if (input.state.status === "sleeping") {
		const { sleepPath, durationMs } = input.state;
		const awakeAt = now + durationMs;
		run.sleepsState[sleepPath] = {
			status: "sleeping",
			awakeAt,
		};
	}

	if (
		input.state.status === "running" &&
		run.state.status === "queued" &&
		(run.state.reason === "retry" || run.state.reason === "new")
	) {
		run.attempts++;
	}

	run.state = input.state;
	run.revision++;

	if (input.state.status === "cancelled") {
		for (const childRunId of Object.keys(run.childWorkflowsRunState)) {
			const childRun = workflowRuns.get(childRunId as WorkflowRunId);
			if (!childRun) {
				throw new NotFoundError(`Workflow run not found: ${runId}`);
			}
			await transitionStateV1.callable({ context })({
				type: "pessimistic",
				id: childRunId,
				state: input.state,
			});
			run.childWorkflowsRunState[childRunId] = input.state;
		}
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
	const taskState = input.taskState;

	assertIsValidTaskStateTransition(runId, taskPath, run.tasksState[taskPath] ?? { status: "none" }, taskState);

	context.logger.info(
		{
			workflowRunId: runId,
			taskPath,
			taskState: taskState,
		},
		"Transitioning task state"
	);

	const now = Date.now();

	const transition: WorkflowRunTransition = {
		type: "task_state",
		createdAt: now,
		taskPath,
		taskState: taskState,
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
	const now = Date.now();

	for (const run of runs) {
		// Reset all failed/running tasks atomically with state transition
		for (const [taskPath, taskState] of Object.entries(run.tasksState)) {
			if (taskState.status === "failed" || taskState.status === "running") {
				run.tasksState[taskPath] = { status: "none" };
			}
		}

		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledAt: now, reason: "retry" },
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
	const now = Date.now();

	for (const run of runs) {
		await transitionStateV1.callable({ context })({
			type: "optimistic",
			id: run.id,
			state: { status: "scheduled", scheduledAt: now, reason: "awake" },
			expectedRevision: run.revision,
		});
	}
}

export const workflowRunRouter = os.router({
	listV1,
	getByIdV1,
	getStateV1,
	createV1,
	transitionStateV1,
	transitionTaskStateV1,
	listTransitionsV1,
});
