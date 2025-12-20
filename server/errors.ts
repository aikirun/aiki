import type { TaskPath, TaskStatus } from "@aikirun/types/task";
import type { WorkflowRunStatus } from "@aikirun/types/workflow-run";

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
		public readonly workflowRunId: string,
		public readonly fromStatus: WorkflowRunStatus,
		public readonly toStatus: WorkflowRunStatus,
		public readonly reason?: string
	) {
		const message = `Cannot transition workflow ${workflowRunId} from ${fromStatus} to ${toStatus}`;
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
		public readonly workflowRunId: string,
		public readonly taskPath: TaskPath,
		public readonly fromStatus: TaskStatus,
		public readonly toStatus: TaskStatus
	) {
		super(`Cannot transition workflow ${workflowRunId} task ${taskPath} from ${fromStatus} to ${toStatus}`);
		this.name = "InvalidTaskStateTransitionError";
	}
}
