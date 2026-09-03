import { NotFoundError } from "@aikirun/lib/error";
import type { TaskSetStateRequestV1 } from "@aikirun/types/api/task";
import { isTerminalWorkflowRunStatus, type WorkflowRunId } from "@aikirun/types/workflow/run";
import type { TaskId, TaskName, TaskRecord, TaskState } from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import { assertIsValidTaskStateTransition } from "./state-machine/task";
import { TaskStateConflictError, WorkflowRunTerminatedError } from "../errors";
import type { Repositories, TxRepositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

export interface TaskServiceDeps {
	repos: Repositories;
}

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
			attempts: task.attempts,
			state: task.state,
		};
	},

	async setTaskState(context: NamespaceRequestContext, request: TaskSetStateRequestV1): Promise<void> {
		await repos.transaction(async (txRepos) => setTaskStateInTx(context, request, txRepos));
		context.logger.info("Task state set", {
			"aiki.workflowRunId": request.workflowRunId,
			"aiki.taskId": request.id,
			"aiki.state": request.state,
		});
	},
});

export type TaskService = ReturnType<typeof createTaskService>;

async function setTaskStateInTx(
	{ namespaceId }: NamespaceRequestContext,
	request: TaskSetStateRequestV1,
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

	const attempts = existingTaskRow.attempts + 1;

	const state: TaskState =
		request.state.status === "completed"
			? { status: "completed", output: request.state.output }
			: { status: request.state.status satisfies "failed", error: request.state.error };

	const transitionId = ulid();
	await txRepos.stateTransition.append({
		id: transitionId,
		workflowRunId: runId,
		type: "task",
		taskId: existingTaskRow.id,
		status: state.status,
		attempt: attempts,
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
			attempts,
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
