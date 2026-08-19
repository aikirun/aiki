import { NotFoundError } from "@aikirun/lib/error";
import type {
	TaskSetStateRequestExisting,
	TaskSetStateRequestNew,
	TaskSetStateRequestV1,
} from "@aikirun/types/api/task";
import { isTerminalWorkflowRunStatus, type WorkflowRunId } from "@aikirun/types/workflow/run";
import type { TaskId, TaskName, TaskRecord, TaskState, TaskStateRunning } from "@aikirun/types/workflow/task";
import { monotonicFactory, ulid } from "ulidx";

import { assertIsValidTaskStateTransition } from "./state-machine/task";
import { TaskStateConflictError, WorkflowRunTerminatedError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface TaskServiceDeps {
	repos: Repositories;
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
			state: task.state,
		};
	},

	async setTaskState(context: NamespaceRequestContext, request: TaskSetStateRequestV1): Promise<void> {
		if (request.type === "new") {
			const taskId = await repos.transaction(async (txRepos) => setNewTaskStateInTx(context, request, txRepos));
			context.logger.info("New task state set", {
				"aiki.taskId": taskId,
				"aiki.state": request.state,
			});
			return;
		}
		await repos.transaction(async (txRepos) => setExistingTaskStateInTx(context, request, txRepos));
		context.logger.info("Existing task state set", {
			"aiki.taskId": request.id,
			"aiki.state": request.state,
		});
	},
});

export type TaskService = ReturnType<typeof createTaskService>;

async function setNewTaskStateInTx(
	{ namespaceId }: NamespaceRequestContext,
	request: TaskSetStateRequestNew,
	txRepos: TxRepositories
): Promise<TaskId> {
	const runId = request.workflowRunId as WorkflowRunId;
	const run = await txRepos.workflowRun.getById({ namespaceId, id: runId }, { lock: "share" });
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (isTerminalWorkflowRunStatus(run.status)) {
		throw new WorkflowRunTerminatedError(runId, run.status);
	}

	const taskId = ulid() as TaskId;
	const runningStateTransitionId = monotonicUlid();
	const targetStateTransitionId = monotonicUlid();

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
		inputHash: request.inputHash,
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

	return taskId;
}

async function setExistingTaskStateInTx(
	{ namespaceId }: NamespaceRequestContext,
	request: TaskSetStateRequestExisting,
	txRepos: TxRepositories
): Promise<void> {
	const runId = request.workflowRunId as WorkflowRunId;
	const run = await txRepos.workflowRun.getById({ namespaceId, id: runId }, { lock: "share" });
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (isTerminalWorkflowRunStatus(run.status)) {
		throw new WorkflowRunTerminatedError(runId, run.status);
	}

	const existingTaskRow = await txRepos.task.getById({ id: request.id, workflowRunId: runId });
	if (!existingTaskRow) {
		throw new NotFoundError(`Task not found: ${request.id}`);
	}

	assertIsValidTaskStateTransition(
		runId,
		existingTaskRow.name as TaskName,
		existingTaskRow.id as TaskId,
		existingTaskRow.status,
		request.state.status
	);

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
	const updatedTask = await txRepos.task.update(
		{
			id: existingTaskRow.id,
			workflowRunId: runId,
			status: existingTaskRow.status,
			attempts: existingTaskRow.attempts,
		},
		{
			status: state.status,
			attempts: state.attempts,
			latestStateTransitionId: transitionId,
		}
	);
	if (!updatedTask) {
		throw new TaskStateConflictError(runId, existingTaskRow.id as TaskId, {
			status: existingTaskRow.status,
			attempts: existingTaskRow.attempts,
		});
	}
}
