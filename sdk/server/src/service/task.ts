import { hashInput } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import type {
	TaskSetStateRequestExisting,
	TaskSetStateRequestNew,
	TaskSetStateRequestV1,
} from "@aikirun/types/api/task";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import type { TaskRecord, TaskState, TaskStateRunning } from "@aikirun/types/workflow/task";
import { monotonicFactory, ulid } from "ulidx";

import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface TaskServiceDeps {
	repos: Pick<Repositories, "task" | "workflowRun" | "stateTransition" | "transaction">;
}

const monotonicUlid = monotonicFactory();

export const createTaskService = ({ repos }: TaskServiceDeps) => ({
	async getTaskById(context: NamespaceRequestContext, taskId: string): Promise<TaskRecord> {
		const task = await repos.task.getByIdWithState(context.namespaceId, taskId);
		if (!task) {
			throw new NotFoundError(`Task not found: ${taskId}`);
		}

		return {
			id: task.id,
			name: task.name,
			workflowRunId: task.workflowRunId,
			input: task.input,
			inputHash: task.inputHash,
			options: task.options !== null ? task.options : undefined,
			state: task.state as TaskState,
		};
	},

	async setTaskState(context: NamespaceRequestContext, request: TaskSetStateRequestV1): Promise<void> {
		if (request.type === "new") {
			const inputHash = await hashInput(request.input);
			return repos.transaction(async (txRepos) => setNewTaskStateInTx(context, request, inputHash, txRepos));
		}
		return repos.transaction(async (txRepos) => setExistingTaskStateInTx(context, request, txRepos));
	},
});

export type TaskService = ReturnType<typeof createTaskService>;

async function setNewTaskStateInTx(
	context: NamespaceRequestContext,
	request: TaskSetStateRequestNew,
	inputHash: string,
	txRepos: Pick<Repositories, "task" | "workflowRun" | "stateTransition">
): Promise<void> {
	const { namespaceId, logger } = context;
	const runId = request.workflowRunId as WorkflowRunId;
	const run = await txRepos.workflowRun.getById(namespaceId, runId, { forUpdate: true });
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const taskId = ulid();
	const runningStateTransitionId = monotonicUlid();
	const targetStateTransitionId = monotonicUlid();

	logger.info("Setting task state (new task)", {
		"aiki.runId": runId,
		"aiki.taskId": taskId,
		"aiki.state": request.state,
	});

	const runningState: TaskStateRunning = {
		status: "running",
		attempts: 1,
	};

	const targetState: TaskState =
		request.state.status === "completed"
			? { status: "completed", attempts: 1, output: request.state.output }
			: { status: request.state.status satisfies "failed", attempts: 1, error: request.state.error };

	await txRepos.task.create({
		id: taskId,
		name: request.taskName,
		workflowRunId: runId,
		status: targetState.status,
		attempts: 1,
		input: request.input,
		inputHash: inputHash,
		options: null,
		latestStateTransitionId: targetStateTransitionId,
	});
	await txRepos.stateTransition.appendBatch([
		{
			id: runningStateTransitionId,
			workflowRunId: runId,
			type: "task",
			taskId,
			status: runningState.status,
			attempt: runningState.attempts,
			state: runningState,
		},
		{
			id: targetStateTransitionId,
			workflowRunId: runId,
			type: "task",
			taskId,
			status: targetState.status,
			attempt: targetState.attempts,
			state: targetState,
		},
	]);
}

async function setExistingTaskStateInTx(
	context: NamespaceRequestContext,
	request: TaskSetStateRequestExisting,
	txRepos: Pick<Repositories, "task" | "workflowRun" | "stateTransition">
): Promise<void> {
	const { namespaceId, logger } = context;
	const runId = request.workflowRunId as WorkflowRunId;
	const run = await txRepos.workflowRun.getById(namespaceId, runId, { forUpdate: true });
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const existingTaskRow = await txRepos.task.getById({ id: request.id, workflowRunId: runId });
	if (!existingTaskRow) {
		throw new NotFoundError(`Task not found: ${request.id}`);
	}

	logger.info("Setting task state (existing task)", {
		"aiki.runId": runId,
		"aiki.taskId": request.id,
		"aiki.state": request.state,
	});

	const attempts = existingTaskRow.attempts;

	const state: TaskState =
		request.state.status === "completed"
			? { status: "completed", attempts: attempts + 1, output: request.state.output }
			: { status: request.state.status satisfies "failed", attempts: attempts + 1, error: request.state.error };

	const transitionId = ulid();
	await txRepos.stateTransition.append({
		id: transitionId,
		workflowRunId: runId,
		type: "task",
		taskId: existingTaskRow.id,
		status: state.status,
		attempt: state.attempts,
		state: state,
	});
	await txRepos.task.update(
		{ id: existingTaskRow.id, workflowRunId: runId },
		{
			status: state.status,
			attempts: state.attempts,
			latestStateTransitionId: transitionId,
		}
	);
}
