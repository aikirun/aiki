import { baseImplementer } from "./base";
import {
	isTerminalState,
	type WorkflowRunStateSleeping,
	type TerminalWorlfowRunState,
	type WorkflowRun,
	type WorkflowRunId,
	type WorkflowRunStateCancelled,
	type WorkflowRunTransition,
} from "@aikirun/types/workflow-run";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import { ConflictError, InvalidStateTransitionError, NotFoundError } from "../errors";
import { publishWorkflowReadyBatch } from "../redis/publisher";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Redis } from "ioredis";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { Logger } from "../logger/index";

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

const transitionStateV1 = os.transitionStateV1.handler(({ input, context }) => {
	const runId = input.id as WorkflowRunId;

	context.logger.info(
		{
			workflowRunId: runId,
			status: input.state.status,
		},
		"Transitioning workflow run state"
	);

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision
		);
	}

	if (isTerminalState(input.state) && isTerminalState(run.state)) {
		throw new InvalidStateTransitionError(runId, run.state.status, input.state.status);
	}

	const transition: WorkflowRunTransition = {
		type: "state",
		createdAt: Date.now(),
		state: input.state,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.state = input.state;
	run.revision++;

	if (input.state.status === "running") {
		run.attempts++;
	}

	if (input.state.status === "sleeping") {
		const sleepingState = input.state;
		const awakeAt = Date.now() + sleepingState.durationMs;
		run.sleepsState[sleepingState.sleepPath] = {
			status: "sleeping",
			awakeAt,
		};
	}

	if (input.state.status === "cancelled") {
		cancelChildWorkflowRuns(run, input.state.reason);
	}

	return { newRevision: run.revision };
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input, context }) => {
	const runId = input.id as WorkflowRunId;

	context.logger.info(
		{
			workflowRunId: runId,
			taskPath: input.taskPath,
			taskStatus: input.taskState.status,
		},
		"Transitioning task state"
	);

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision
		);
	}

	const transition: WorkflowRunTransition = {
		type: "task_state",
		createdAt: Date.now(),
		taskPath: input.taskPath,
		taskState: input.taskState,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.tasksState[input.taskPath] = input.taskState;
	run.revision++;

	return { newRevision: run.revision };
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

export function getScheduledWorkflows(): WorkflowRun[] {
	const now = Date.now();
	const scheduled: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "scheduled") {
			const scheduledState = run.state;
			if (scheduledState.scheduledAt <= now) {
				scheduled.push(run);
			}
		}
	}

	return scheduled;
}

export async function transitionScheduledWorkflowRunsToQueued(redis: Redis, logger: Logger) {
	const messagesToPublish = [];
	for (const run of getScheduledWorkflows()) {
		run.state = {
			status: "queued",
			reason: "new",
		};
		run.revision++;

		logger.info(
			{
				workflowId: run.workflowId,
				workflowVersionId: run.workflowVersionId,
				workflowRunId: run.id,
			},
			"Transitioned workflow from scheduled to queued"
		);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowId: run.workflowId,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish, logger);
	}
}

export function getRetryableWorkflows(): WorkflowRun[] {
	const now = Date.now();
	const retryable: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "awaiting_retry") {
			const awaitingRetryState = run.state;
			if (awaitingRetryState.nextAttemptAt <= now) {
				retryable.push(run);
			}
		}
	}

	return retryable;
}

export async function transitionRetryableWorkflowRunsToQueued(redis: Redis, logger: Logger) {
	const messagesToPublish = [];
	for (const run of getRetryableWorkflows()) {
		// Reset all failed/running tasks atomically with state transition
		for (const [path, taskState] of Object.entries(run.tasksState)) {
			if (taskState.status === "failed" || taskState.status === "running") {
				run.tasksState[path] = { status: "none" };
			}
		}

		run.state = {
			status: "queued",
			reason: "retry",
		};
		run.revision++;

		logger.info(
			{
				workflowId: run.workflowId,
				workflowVersionId: run.workflowVersionId,
				workflowRunId: run.id,
			},
			"Transitioned workflow from awaiting_retry to queued"
		);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowId: run.workflowId,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish, logger);
	}
}

export function getSleepingWorkflowRuns(): WorkflowRun[] {
	const now = Date.now();
	const sleepingRuns: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "sleeping") {
			const sleepingState = run.state;
			const sleepState = run.sleepsState[sleepingState.sleepPath];
			if (sleepState?.status === "sleeping" && sleepState.awakeAt <= now) {
				sleepingRuns.push(run);
			}
		}
	}

	return sleepingRuns;
}

export async function transitionSleepingWorkflowRunsToQueued(redis: Redis, logger: Logger) {
	const now = Date.now();
	const messagesToPublish = [];
	for (const run of getSleepingWorkflowRuns()) {
		const sleepPath = (run.state as WorkflowRunStateSleeping).sleepPath;
		run.sleepsState[sleepPath] = {
			status: "completed",
			completedAt: now,
		};

		run.state = {
			status: "queued",
			reason: "awake",
		};
		run.revision++;

		logger.info(
			{
				workflowId: run.workflowId,
				workflowVersionId: run.workflowVersionId,
				workflowRunId: run.id,
			},
			"Transitioned workflow from sleeping to queued"
		);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowId: run.workflowId,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish, logger);
	}
}

function cancelWorkflowRun(runId: WorkflowRunId, reason: string | undefined): TerminalWorlfowRunState<unknown> {
	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	if (isTerminalState(run.state)) {
		return run.state;
	}

	const cancelledState: WorkflowRunStateCancelled = {
		status: "cancelled",
		reason,
	};

	const transition: WorkflowRunTransition = {
		type: "state",
		createdAt: Date.now(),
		state: cancelledState,
	};

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.state = cancelledState;
	run.revision++;

	cancelChildWorkflowRuns(run, reason);

	return cancelledState;
}

function cancelChildWorkflowRuns(run: WorkflowRun<unknown, unknown>, reason: string | undefined): void {
	for (const childId of Object.keys(run.childWorkflowsRunState)) {
		const cancelledChildState = cancelWorkflowRun(childId as WorkflowRunId, reason);
		run.childWorkflowsRunState[childId] = cancelledChildState;
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
