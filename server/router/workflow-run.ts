import { baseImplementer } from "./base.ts";
import type { WorkflowRun } from "@aiki/types/workflow-run";
import { ConflictError, NotFoundError } from "../middleware/error-handler.ts";

const os = baseImplementer.workflowRun;

const workflowRuns = new Map<string, WorkflowRun<unknown, unknown>>();

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
	const run: WorkflowRun<unknown, unknown> = {
		id: runId,
		name: input.name,
		versionId: input.versionId,
		revision: 0,
		attempts: 1,
		input: input.input,
		options: input.options ?? {},
		state: {
			status: "queued",
			reason: "new",
		},
		tasksState: {},
		subWorkflowsRunState: {},
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

export function getRetryableWorkflows(): Array<{ id: string; run: WorkflowRun<unknown, unknown> }> {
	const now = Date.now();
	const retryable: Array<{ id: string; run: WorkflowRun<unknown, unknown> }> = [];

	for (const [id, run] of workflowRuns.entries()) {
		if (run.state.status === "awaiting_retry") {
			const awaitingRetryState = run.state;
			if (awaitingRetryState.nextAttemptAt <= now) {
				retryable.push({ id, run });
			}
		}
	}

	return retryable;
}

export function transitionRetryableWorkflowsToQueued() {
	for (const { id, run } of getRetryableWorkflows()) {
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
		// TODO: Incrementing the attempt counter should be done when the workflow is transitioned into running state.
		// run.attempts++;

		// deno-lint-ignore no-console
		console.log(`Transitioned workflow ${id} from awaiting_retry to queued`);
	}
}

export const workflowRunRouter = os.router({
	getByIdV1,
	getStateV1,
	createV1,
	transitionTaskStateV1,
	transitionStateV1,
});
