import { baseImplementer } from "./base.ts";
import type { WorkflowRun, WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import { ConflictError, NotFoundError } from "../middleware/error-handler.ts";
import { publishWorkflowReadyBatch } from "../redis/publisher.ts";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Redis } from "ioredis";
import { isNonEmptyArray } from "@aikirun/lib/array";

const os = baseImplementer.workflowRun;

const workflowRuns = new Map<WorkflowRunId, WorkflowRun>();
const workflowRunsIdempotencyMap = new Map<WorkflowName, Map<WorkflowVersionId, Map<string, WorkflowRunId>>>();
const workflowRunTransitions = new Map<WorkflowRunId, WorkflowRunTransition[]>();

const listV1 = os.listV1.handler(({ input }) => {
	const { filters, limit = 50, offset = 0, sort } = input;

	const runs: WorkflowRun<unknown, unknown>[] = [];

	for (const run of workflowRuns.values()) {
		if (
			filters?.workflows &&
			isNonEmptyArray(filters.workflows) &&
			filters.workflows.every((w) =>
				(w.name && w.name !== run.name) ||
				(w.versionId && w.versionId !== run.versionId)
			)
		) {
			continue;
		}

		if (
			filters?.status &&
			isNonEmptyArray(filters.status) &&
			filters.status.every((s) => (s !== run.state.status))
		) {
			continue;
		}

		runs.push(run);
	}

	return {
		runs: runs
			.sort((a, b) => sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
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

const getByIdV1 = os.getByIdV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run by id: ${input.id}`);

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run state for id: ${input.id}`);

	const run = workflowRuns.get(input.id as WorkflowRunId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Creating workflow run: ${input.name}/${input.versionId}`);

	const name = input.name as WorkflowName;
	const versionId = input.versionId as WorkflowVersionId;
	const idempotencyKey = input.options?.idempotencyKey;

	if (idempotencyKey) {
		const existingRunId = workflowRunsIdempotencyMap.get(name)?.get(versionId)?.get(idempotencyKey);
		if (existingRunId) {
			// deno-lint-ignore no-console
			console.log(`Returning existing run: ${existingRunId}`);
			const existingRun = workflowRuns.get(existingRunId)!;
			return { run: existingRun };
		}
	}

	const now = Date.now();
	const runId = `${now}` as WorkflowRunId;

	const trigger = input.options?.trigger;

	const run: WorkflowRun = {
		id: runId,
		name: input.name,
		versionId: input.versionId,
		createdAt: now,
		revision: 0,
		attempts: 0,
		input: input.input,
		options: input.options ?? {},
		state: {
			status: "scheduled",
			scheduledAt: !trigger || trigger.type === "immediate"
				? now
				: trigger.type === "delayed"
				? "delayMs" in trigger ? now + trigger.delayMs : now + toMilliseconds(trigger.delay)
				: trigger.startAt,
		},
		tasksState: {},
		childWorkflowsRunState: {},
	};

	workflowRuns.set(runId, run);

	if (idempotencyKey) {
		let versionMap = workflowRunsIdempotencyMap.get(name);
		if (!versionMap) {
			versionMap = new Map();
			workflowRunsIdempotencyMap.set(name, versionMap);
		}

		let idempotencyKeyMap = versionMap.get(versionId);
		if (!idempotencyKeyMap) {
			idempotencyKeyMap = new Map();
			versionMap.set(versionId, idempotencyKeyMap);
		}

		idempotencyKeyMap.set(idempotencyKey, runId);
	}

	return { run };
});

const transitionStateV1 = os.transitionStateV1.handler(({ input }) => {
	const runId = input.id as WorkflowRunId;

	// deno-lint-ignore no-console
	console.log(`Transitioning workflow run state: ${runId} -> ${input.state.status}`);

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision,
		);
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

	return { newRevision: run.revision };
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input }) => {
	const runId = input.id as WorkflowRunId;

	// deno-lint-ignore no-console
	console.log(`Transitioning task state for workflow run: ${runId}, task: ${input.taskPath}`);

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision,
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
			.sort((a, b) => sort?.order === "asc" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)
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

export async function transitionScheduledWorkflowsToQueued(redis: Redis) {
	const messagesToPublish = [];
	for (const run of getScheduledWorkflows()) {
		run.state = {
			status: "queued",
			reason: "new",
		};
		run.revision++;

		// deno-lint-ignore no-console
		console.log(`Transitioned workflow ${run.name}/${run.versionId}/${run.id} from scheduled to queued`);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowName: run.name,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish);
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

export async function transitionRetryableWorkflowsToQueued(redis: Redis) {
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

		// deno-lint-ignore no-console
		console.log(`Transitioned workflow ${run.name}/${run.versionId}/${run.id} from awaiting_retry to queued`);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowName: run.name,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish);
	}
}

export function getSleepingWorkflows(): WorkflowRun[] {
	const now = Date.now();
	const sleeping: WorkflowRun[] = [];

	for (const run of workflowRuns.values()) {
		if (run.state.status === "sleeping") {
			const sleepingState = run.state;
			if (sleepingState.awakeAt <= now) {
				sleeping.push(run);
			}
		}
	}

	return sleeping;
}

export async function transitionSleepingWorkflowsToQueued(redis: Redis) {
	const messagesToPublish = [];
	for (const run of getSleepingWorkflows()) {
		run.state = {
			status: "queued",
			reason: "awake",
		};
		run.revision++;

		// deno-lint-ignore no-console
		console.log(`Transitioned workflow ${run.name}/${run.versionId}/${run.id} from sleeping to queued`);

		messagesToPublish.push({
			workflowRunId: run.id,
			workflowName: run.name,
			shardKey: run.options.shardKey,
		});
	}

	if (messagesToPublish.length > 0) {
		await publishWorkflowReadyBatch(redis, messagesToPublish);
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
