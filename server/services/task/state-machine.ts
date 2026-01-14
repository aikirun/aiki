import { hashInput } from "@aikirun/lib";
import { getTaskPath } from "@aikirun/lib/path";
import type { TaskId, TaskName, TaskPath, TaskState, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunId, WorkflowRunTransition } from "@aikirun/types/workflow-run";
import type {
	TransitionTaskStateToRunning,
	WorkflowRunTransitionTaskStateRequestV1,
	WorkflowRunTransitionTaskStateResponseV1,
} from "@aikirun/types/workflow-run-api";
import { InvalidTaskStateTransitionError, NotFoundError, RevisionConflictError, ValidationError } from "server/errors";
import { findTaskById, workflowRuns, workflowRunTransitions } from "server/infrastructure/persistence/in-memory-store";
import type { ServerContext } from "server/middleware";

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
	context: ServerContext,
	request: WorkflowRunTransitionTaskStateRequestV1
): Promise<WorkflowRunTransitionTaskStateResponseV1> {
	const runId = request.id as WorkflowRunId;

	const run = workflowRuns.get(runId);
	if (!run) {
		throw new NotFoundError(`Workflow run not found: ${runId}`);
	}
	if (run.revision !== request.expectedRevision) {
		throw new RevisionConflictError(runId, request.expectedRevision, run.revision);
	}

	let inputHash: string;
	let taskName: TaskName;
	let taskPath: TaskPath;
	let taskId: TaskId;
	let existingTaskState: TaskState | undefined;
	let taskState: TaskState;
	const now = Date.now();

	if (isTaskStateTransitionToRunning(request) && request.type === "create") {
		inputHash = await hashInput(request.taskState.input);
		taskName = request.taskName as TaskName;
		taskPath = getTaskPath(taskName, request.options?.reference?.id ?? inputHash);

		const existingTaskInfo = run.tasks[taskPath];
		if (existingTaskInfo) {
			throw new ValidationError(`Task ${taskPath} already exists. Use type: "retry" to retry it.`);
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
		taskPath = existingTaskInfo.path;
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

	const transitions = workflowRunTransitions.get(runId);
	if (!transitions) {
		workflowRunTransitions.set(runId, [transition]);
	} else {
		transitions.push(transition);
	}

	run.tasks[taskPath] = { id: taskId, name: taskName, state: taskState, inputHash };
	run.revision++;

	return { run, taskId };
}
