import type { TaskId, TaskName, TaskStatus } from "@aikirun/types/task";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunStatus } from "@aikirun/types/workflow-run";

export class NotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NotFoundError";
	}
}

export class ValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}

export class UnauthorizedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class WorkflowRunRevisionConflictError extends Error {
	public readonly workflowRunId: WorkflowRunId;
	public readonly expectedRevision: number;
	public readonly actualRevision: number;

	constructor(workflowRunId: WorkflowRunId, expectedRevision: number, actualRevision: number) {
		super(`Revision conflict for workflow ${workflowRunId}: expected ${expectedRevision}, actual is ${actualRevision}`);
		this.name = "WorkflowRunRevisionConflictError";
		this.workflowRunId = workflowRunId;
		this.expectedRevision = expectedRevision;
		this.actualRevision = actualRevision;
	}
}

export class InvalidWorkflowRunStateTransitionError extends Error {
	public readonly workflowRunId: WorkflowRunId;
	public readonly from: WorkflowRunStatus;
	public readonly to: WorkflowRunStatus;
	public readonly reason?: string;

	constructor(workflowRunId: WorkflowRunId, from: WorkflowRunStatus, to: WorkflowRunStatus, reason?: string) {
		const baseMessage = `Cannot transition workflow ${workflowRunId} from ${from} to ${to}`;
		const message = reason ? `${baseMessage} - ${reason}` : baseMessage;
		super(message);
		this.name = "InvalidWorkflowRunStateTransitionError";
		this.workflowRunId = workflowRunId;
		this.from = from;
		this.to = to;
		this.reason = reason;
	}
}

export class InvalidTaskStateTransitionError extends Error {
	public readonly workflowRunId: WorkflowRunId;
	public readonly taskData:
		| { taskId: TaskId; from: TaskStatus; to: TaskStatus }
		| { taskName: TaskName; to: TaskStatus };

	constructor(
		workflowRunId: WorkflowRunId,
		taskData: { taskId: TaskId; from: TaskStatus; to: TaskStatus } | { taskName: TaskName; to: TaskStatus }
	) {
		const message =
			"from" in taskData
				? `Cannot transition task ${taskData.taskId} from ${taskData.from} to ${taskData.to} (workflow ${workflowRunId})`
				: `Cannot create task ${taskData.taskName} directly in ${taskData.to} state (workflow ${workflowRunId})`;
		super(message);
		this.name = "InvalidTaskStateTransitionError";
		this.workflowRunId = workflowRunId;
		this.taskData = taskData;
	}
}

export class ScheduleConflictError extends Error {
	public readonly referenceId: string;

	constructor(referenceId: string) {
		super(`Schedule already exists with reference: ${referenceId}`);
		this.name = "ScheduleConflictError";
		this.referenceId = referenceId;
	}
}

export class WorkflowRunConflictError extends Error {
	public readonly workflowName: WorkflowName;
	public readonly workflowVersionId: WorkflowVersionId;
	public readonly referenceId: string;

	constructor(workflowName: WorkflowName, workflowVersionId: WorkflowVersionId, referenceId: string) {
		super(`Workflow ${workflowName}:${workflowVersionId} run already exists with reference: ${referenceId}`);
		this.name = "WorkflowRunConflictError";
		this.workflowName = workflowName;
		this.workflowVersionId = workflowVersionId;
		this.referenceId = referenceId;
	}
}

export class TaskConflictError extends Error {
	public readonly workflowRunId: WorkflowRunId;
	public readonly taskName: string;

	constructor(workflowRunId: WorkflowRunId, taskName: string, referenceId: string) {
		super(`Task ${taskName} already exists with reference ${referenceId} in workflow ${workflowRunId}`);
		this.name = "TaskConflictError";
		this.workflowRunId = workflowRunId;
		this.taskName = taskName;
	}
}
