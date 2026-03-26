import { hashInput } from "@aikirun/lib/crypto";
import type { TaskId, TaskInfo, TaskName, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import type {
	TransitionTaskStateToRunning,
	WorkflowRunTransitionTaskStateRequestV1,
} from "@aikirun/types/workflow-run-api";
import { InvalidTaskStateTransitionError, NotFoundError, WorkflowRunRevisionConflictError } from "server/errors";
import type { Repositories } from "server/infra/db/types";
import type { NamespaceRequestContext } from "server/middleware/context";
import { ulid } from "ulidx";

const validTaskStatusTransitions: Record<TaskStatus, TaskStatus[]> = {
	running: ["running", "awaiting_retry", "completed", "failed"],
	awaiting_retry: ["running"],
	completed: [],
	failed: [],
};

export function assertIsValidTaskStateTransition(
	runId: WorkflowRunId,
	taskName: TaskName,
	taskId: TaskId,
	from: TaskStatus | undefined,
	to: TaskStatus
) {
	if (!from) {
		if (to !== "running") {
			throw new InvalidTaskStateTransitionError(runId, { taskName, to });
		}
		return;
	}

	const allowedDestinations = validTaskStatusTransitions[from];
	if (!allowedDestinations.includes(to)) {
		throw new InvalidTaskStateTransitionError(runId, { taskId, from, to });
	}
}

export function isTaskStateTransitionToRunning(
	request: WorkflowRunTransitionTaskStateRequestV1
): request is TransitionTaskStateToRunning {
	return request.taskState.status === "running";
}

export interface TaskStateMachineServiceDeps {
	repos: Pick<Repositories, "workflowRun" | "task" | "stateTransition" | "transaction">;
}

export function createTaskStateMachineService(deps: TaskStateMachineServiceDeps) {
	const { repos } = deps;
	return {
		async transitionState(
			context: NamespaceRequestContext,
			request: WorkflowRunTransitionTaskStateRequestV1,
			txRepos?: Pick<Repositories, "workflowRun" | "task" | "stateTransition">
		): Promise<TaskInfo> {
			if (txRepos) {
				return transitionStateInTx(context, request, txRepos);
			} else {
				return repos.transaction(async (transactionRepos) => transitionStateInTx(context, request, transactionRepos));
			}
		},
	};
}

export type TaskStateMachineService = ReturnType<typeof createTaskStateMachineService>;

async function transitionStateInTx(
	context: NamespaceRequestContext,
	request: WorkflowRunTransitionTaskStateRequestV1,
	txRepos: Pick<Repositories, "workflowRun" | "task" | "stateTransition">
): Promise<TaskInfo> {
	const namespaceId = context.namespaceId;
	const runId = request.id as WorkflowRunId;

	const run = await txRepos.workflowRun.getById(namespaceId, runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (run.revision !== request.expectedWorkflowRunRevision) {
		throw new WorkflowRunRevisionConflictError(runId, request.expectedWorkflowRunRevision);
	}

	const now = Date.now();

	if (isTaskStateTransitionToRunning(request) && request.type === "create") {
		const inputHash = await hashInput(request.taskState.input);
		const taskName = request.taskName as TaskName;
		const taskId = ulid() as TaskId;
		const stateTransitionId = ulid();

		const taskState: TaskState = {
			status: "running",
			attempts: request.taskState.attempts,
			input: request.taskState.input,
		};

		assertIsValidTaskStateTransition(runId, taskName, taskId, undefined, taskState.status);

		await txRepos.task.create({
			id: taskId,
			name: taskName,
			workflowRunId: runId,
			status: taskState.status,
			attempts: taskState.attempts,
			input: request.taskState.input,
			inputHash,
			options: request.options,
			latestStateTransitionId: stateTransitionId,
		});
		await txRepos.stateTransition.append({
			id: stateTransitionId,
			workflowRunId: runId,
			type: "task",
			taskId,
			status: taskState.status,
			attempt: taskState.attempts,
			state: taskState,
		});

		context.logger.info({ runId, taskId, taskState }, "Created new task");

		return { id: taskId, name: taskName, state: taskState, inputHash };
	}

	const existingTask = await txRepos.task.getById(request.taskId);
	if (!existingTask) {
		throw new NotFoundError(`Task not found: ${request.taskId}`);
	}

	const inputHash = existingTask.inputHash;
	const taskName = existingTask.name as TaskName;
	const taskId = existingTask.id as TaskId;

	const taskState: TaskState =
		request.taskState.status === "running"
			? {
					status: "running",
					attempts: request.taskState.attempts,
					input: request.taskState.input,
				}
			: request.taskState.status === "completed"
				? {
						status: "completed",
						attempts: request.taskState.attempts,
						output: request.taskState.output,
					}
				: request.taskState.status === "awaiting_retry"
					? {
							status: "awaiting_retry",
							attempts: request.taskState.attempts,
							error: request.taskState.error,
							nextAttemptAt: now + request.taskState.nextAttemptInMs,
						}
					: request.taskState;

	assertIsValidTaskStateTransition(runId, taskName, taskId, existingTask.status, taskState.status);

	const stateTransitionId = ulid();
	await txRepos.stateTransition.append({
		id: stateTransitionId,
		workflowRunId: runId,
		type: "task",
		taskId,
		status: taskState.status,
		attempt: taskState.attempts,
		state: taskState,
	});

	await txRepos.task.update(taskId, {
		status: taskState.status,
		attempts: taskState.attempts,
		latestStateTransitionId: stateTransitionId,
		nextAttemptAt: taskState.status === "awaiting_retry" ? new Date(taskState.nextAttemptAt) : null,
	});

	context.logger.info({ runId, taskId, taskState }, "Transitioning task state");

	return { id: taskId, name: taskName, state: taskState, inputHash };
}
