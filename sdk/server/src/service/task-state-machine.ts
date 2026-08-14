import { hashInput } from "@aikirun/lib/crypto";
import { NotFoundError } from "@aikirun/lib/error";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { TaskTransitionStateRequestV1, TransitionTaskStateToRunning } from "@aikirun/types/api/task";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import type {
	TaskId,
	TaskInfo,
	TaskName,
	TaskState,
	TaskStateFailed,
	TaskStateRunning,
	TaskStatus,
} from "@aikirun/types/workflow/task";
import { ulid } from "ulidx";

import { InvalidTaskStateTransitionError, TaskStateConflictError, WorkflowRunRevisionConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";

const validTaskStatusTransitions: Record<TaskStatus, TaskStatus[]> = {
	running: ["running", "awaiting_retry", "completed", "failed"],
	awaiting_retry: ["running"],
	completed: [],
	failed: [],
	discarded: [],
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
	request: TaskTransitionStateRequestV1
): request is TransitionTaskStateToRunning {
	return request.taskState.status === "running";
}

export interface TaskStateMachineServiceDeps {
	repos: Pick<Repositories, "workflowRun" | "task" | "stateTransition" | "workflowRunOutbox" | "transaction">;
}

export const createTaskStateMachineService = ({ repos }: TaskStateMachineServiceDeps) => ({
	async transitionState(
		context: NamespaceRequestContext,
		request: TaskTransitionStateRequestV1,
		txRepos?: Pick<Repositories, "workflowRun" | "task" | "stateTransition" | "workflowRunOutbox">
	): Promise<TaskInfo> {
		if (txRepos) {
			return transitionStateInTx(context, request, txRepos);
		} else {
			return repos.transaction(async (transactionRepos) => transitionStateInTx(context, request, transactionRepos));
		}
	},
});

export type TaskStateMachineService = ReturnType<typeof createTaskStateMachineService>;

async function transitionStateInTx(
	{ namespaceId, logger }: NamespaceRequestContext,
	request: TaskTransitionStateRequestV1,
	txRepos: Pick<Repositories, "workflowRun" | "task" | "stateTransition" | "workflowRunOutbox">
): Promise<TaskInfo> {
	const runId = request.workflowRunId as WorkflowRunId;
	const run = await txRepos.workflowRun.getById(namespaceId, runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}

	const { expectedWorkflowRunRevision } = request;
	if (run.revision !== expectedWorkflowRunRevision) {
		throw new WorkflowRunRevisionConflictError(runId, expectedWorkflowRunRevision);
	}

	if (isTaskStateTransitionToRunning(request) && request.type === "create") {
		const inputHash = await hashInput(request.input);
		const taskName = request.taskName as TaskName;
		const taskId = ulid() as TaskId;
		const stateTransitionId = ulid();

		const taskState: TaskStateRunning = {
			status: "running",
			attempts: 1,
		};

		assertIsValidTaskStateTransition(runId, taskName, taskId, undefined, taskState.status);

		await txRepos.task.create({
			id: taskId,
			name: taskName,
			workflowRunId: runId,
			status: taskState.status,
			attempts: taskState.attempts,
			input: request.input,
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

		logger.info("Created new task", {
			"aiki.runId": runId,
			"aiki.taskId": taskId,
			"aiki.taskState": taskState,
		});

		return { id: taskId, name: taskName, state: taskState, inputHash };
	}

	const taskId = request.id as TaskId;
	const existingTask = await txRepos.task.getById({ id: taskId, workflowRunId: runId });
	if (!existingTask) {
		throw new NotFoundError(`Task not found: ${taskId}`);
	}

	const inputHash = existingTask.inputHash;
	const taskName = existingTask.name as TaskName;

	const requestTaskState = request.taskState;

	const taskState: TaskState =
		requestTaskState.status === "running"
			? {
					status: requestTaskState.status,
					attempts: requestTaskState.attempts,
				}
			: requestTaskState.status === "completed"
				? {
						status: requestTaskState.status,
						attempts: requestTaskState.attempts,
						output: requestTaskState.output,
					}
				: requestTaskState.status === "awaiting_retry"
					? {
							status: requestTaskState.status,
							attempts: requestTaskState.attempts,
							error: requestTaskState.error,
							nextAttemptAt: Date.now() + requestTaskState.nextAttemptInMs,
						}
					: (requestTaskState satisfies TaskStateFailed);

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

	const updatedTask = await txRepos.task.update(
		{ id: taskId, workflowRunId: runId, status: existingTask.status, attempts: existingTask.attempts },
		{
			status: taskState.status,
			attempts: taskState.attempts,
			latestStateTransitionId: stateTransitionId,
			nextAttemptAt: taskState.status === "awaiting_retry" ? (taskState.nextAttemptAt as TimestampMs) : null,
		}
	);
	if (!updatedTask) {
		throw new TaskStateConflictError(runId, taskId, {
			status: existingTask.status,
			attempts: existingTask.attempts,
		});
	}

	if (taskState.status === "awaiting_retry") {
		// The workflow run stays in `running` while the task waits for its retry, so the outbox row
		// is not cleared by the workflow state machine. Delete it here so `recoverOverdueOutboxEntries`
		// cannot re-dispatch the run before `imminent-retryable-tasks` requeues it at the
		// task's nextAttemptAt. `processImminentRetryableTasks` daemon will reinsert a fresh outbox
		// row when it transitions the workflow to `queued`.
		// Also note that if the entry is not deleted, `processImminentRetryableTasks` will
		// fail on insert due to duplicate key
		await txRepos.workflowRunOutbox.deleteByWorkflowRunId({ namespaceId, workflowRunId: runId });
	}

	logger.info("Transitioning task state", {
		"aiki.runId": runId,
		"aiki.taskId": taskId,
		"aiki.taskState": taskState,
	});

	return { id: taskId, name: taskName, state: taskState, inputHash };
}
