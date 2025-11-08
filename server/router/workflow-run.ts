import { baseImplementer } from "./base.ts";
import type { WorkflowRun } from "@aiki/types/workflow-run";
import { ConflictError, NotFoundError } from "../middleware/error-handler.ts";

const os = baseImplementer.workflowRun;

const workflowRuns = new Map<string, WorkflowRun>();

const getByIdV1 = os.getByIdV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run by id: ${input.id}`);

	const run = workflowRuns.get(input.id);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { run };
});

const getStateV1 = os.getStateV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Fetching workflow run state for id: ${input.id}`);

	const run = workflowRuns.get(input.id);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	return { state: run.state };
});

const createV1 = os.createV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Creating workflow run: ${input.name}/${input.versionId}`);

	const runId = `workflow_run_${Date.now()}`;

	const trigger = input.options?.trigger;

	const run: WorkflowRun = {
		id: runId,
		name: input.name,
		versionId: input.versionId,
		revision: 0,
		attempts: 0,
		input: input.input,
		options: input.options ?? {},
		state: {
			status: "scheduled",
			scheduledAt: !trigger || trigger.type === "immediate"
				? Date.now()
				: trigger.type === "delayed"
				? Date.now() + trigger.delayMs
				: trigger.startAt,
		},
		tasksState: {},
		childWorkflowsRunState: {},
	};

	workflowRuns.set(runId, run);

	return { run };
});

const transitionStateV1 = os.transitionStateV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Transitioning workflow run state: ${input.id} -> ${input.state.status}`);

	const run = workflowRuns.get(input.id);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision,
		);
	}

	run.state = input.state;
	run.revision++;

	if (input.state.status === "running") {
		run.attempts++;
	}

	return { newRevision: run.revision };
});

const transitionTaskStateV1 = os.transitionTaskStateV1.handler(({ input }) => {
	// deno-lint-ignore no-console
	console.log(`Transitioning task state for workflow run: ${input.id}, task: ${input.taskPath}`);

	const run = workflowRuns.get(input.id);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${input.id}`);
	}

	if (run.revision !== input.expectedRevision) {
		throw new ConflictError(
			`Revision conflict: expected ${input.expectedRevision}, current is ${run.revision}`,
			run.revision,
			input.expectedRevision,
		);
	}

	run.tasksState[input.taskPath] = input.taskState;
	run.revision++;

	return { newRevision: run.revision };
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

export function transitionScheduledWorkflowsToQueued() {
	for (const run of getScheduledWorkflows()) {
		run.state = {
			status: "queued",
			reason: "new",
		};
		run.revision++;

		// deno-lint-ignore no-console
		console.log(`Transitioned workflow ${run.id} from scheduled to queued`);
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

export function transitionRetryableWorkflowsToQueued() {
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
		console.log(`Transitioned workflow ${run.id} from awaiting_retry to queued (attempt ${run.attempts})`);
	}
}

export const workflowRunRouter = os.router({
	getByIdV1,
	getStateV1,
	createV1,
	transitionTaskStateV1,
	transitionStateV1,
});
