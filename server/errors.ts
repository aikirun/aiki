import type { TaskId, TaskName, TaskStatus } from "@aikirun/types/task";
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

export class RevisionConflictError extends Error {
	constructor(
		public readonly workflowRunId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision: number
	) {
		super(`Revision conflict for workflow ${workflowRunId}: expected ${expectedRevision}, actual is ${actualRevision}`);
		this.name = "RevisionConflictError";
	}
}

export class InvalidWorkflowRunStateTransitionError extends Error {
	constructor(
		public readonly workflowRunId: WorkflowRunId,
		public readonly from: WorkflowRunStatus,
		public readonly to: WorkflowRunStatus,
		public readonly reason?: string
	) {
		const message = `Cannot transition workflow ${workflowRunId} from ${from} to ${to}`;
		if (!reason) {
			super(message);
		} else {
			super(`${message} - ${reason}`);
		}
		this.name = "InvalidWorkflowRunStateTransitionError";
	}
}

export class InvalidTaskStateTransitionError extends Error {
	constructor(
		public readonly workflowRunId: WorkflowRunId,
		public readonly taskData:
			| { taskId: TaskId; from: TaskStatus; to: TaskStatus }
			| { taskName: TaskName; to: TaskStatus }
	) {
		if ("from" in taskData) {
			super(
				`Cannot transition task ${taskData.taskId} from ${taskData.from} to ${taskData.to} (workflow ${workflowRunId})`
			);
		} else {
			super(`Cannot create task ${taskData.taskName} directly in ${taskData.to} state (workflow ${workflowRunId})`);
		}
		this.name = "InvalidTaskStateTransitionError";
	}
}
