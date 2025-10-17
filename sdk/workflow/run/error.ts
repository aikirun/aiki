import type { WorkflowRunId, WorkflowRunStatus } from "@aiki/types/workflow-run";

export class WorkflowRunConflictError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly operation: string,
		public readonly attempts: number,
	) {
		super(`Conflict while performing ${operation} on workflow ${id} after ${attempts} attempts`);
		this.name = "WorkflowRunConflictError";
	}
}

export class WorkflowRunNotExecutableError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly status: WorkflowRunStatus,
	) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.name = "WorkflowRunNotExecutableError";
	}
}

export class WorkflowRunCancelledError extends WorkflowRunNotExecutableError {
	constructor(id: WorkflowRunId) {
		super(id, "cancelled");
		this.name = "WorkflowRunCancelledError";
	}
}

export class WorkflowRunPausedError extends WorkflowRunNotExecutableError {
	constructor(id: WorkflowRunId) {
		super(id, "paused");
		this.name = "WorkflowRunPausedError";
	}
}
