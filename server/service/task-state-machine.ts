import { hashInput } from "@aikirun/lib";
import { getTaskAddress } from "@aikirun/lib/address";
import type { TaskAddress, TaskId, TaskName, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import type {
	TransitionTaskStateToRunning,
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import {
	InvalidTaskStateTransitionError,
	NotFoundError,
	TaskConflictError,
	WorkflowRunRevisionConflictError,
} from "server/errors";
import { findTaskById, workflowRunsById, workflowRunTransitionsById } from "server/infra/db/in-memory-store";
import type { Context } from "server/middleware/context";

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

export async function transitionTaskState(
	context: Context,
	request: WorkflowRunTransitionTaskStateRequestV1
): Promise<WorkflowRunTransitionTaskStateResponseV1> {
	const runId = request.id as WorkflowRunId;

	const run = workflowRunsById.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (run.revision !== request.expectedWorkflowRunRevision) {
		throw new WorkflowRunRevisionConflictError(runId, request.expectedWorkflowRunRevision, run.revision);
	}

	let inputHash: string;
	let taskName: TaskName;
	let taskAddress: TaskAddress;
	let taskId: TaskId;
	let existingTaskState: TaskState | undefined;
	let taskState: TaskState;
	const now = Date.now();

	if (isTaskStateTransitionToRunning(request) && request.type === "create") {
		inputHash = await hashInput(request.taskState.input);
		taskName = request.taskName as TaskName;
		taskAddress = getTaskAddress(taskName, request.options?.reference?.id ?? inputHash);

		const existingTaskInfo = run.tasks[taskAddress];
		if (existingTaskInfo) {
			throw new TaskConflictError(runId, taskName);
		}

		taskId = crypto.randomUUID() as TaskId;
		taskState = {
			status: request.taskState.status,
			attempts: request.taskState.attempts,
			input: request.taskState.input,
		};
	} else {
		const existingTaskInfo = findTaskById(run, request.taskId as TaskId);
		if (!existingTaskInfo) {
			throw new NotFoundError(`Task not found: ${request.taskId}`);
		}

		inputHash = existingTaskInfo.inputHash;
		taskName = existingTaskInfo.name as TaskName;
		taskAddress = existingTaskInfo.address;
		taskId = existingTaskInfo.id as TaskId;

		existingTaskState = existingTaskInfo.state;
		taskState =
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
	}

	assertIsValidTaskStateTransition(runId, taskName, taskId, existingTaskState?.status, taskState.status);

	context.logger.info({ runId, taskId, taskState }, "Transitioning task state");

	const transition: WorkflowRunTransition = {
		id: crypto.randomUUID(),
		type: "task_state",
		createdAt: now,
		taskId,
		taskState,
	};

	const transitions = workflowRunTransitionsById.get(runId);
	if (!transitions) {
		workflowRunTransitionsById.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	const taskInfo = { id: taskId, name: taskName, state: taskState, inputHash };
	run.tasks[taskAddress] = taskInfo;

	return { taskInfo };
}
