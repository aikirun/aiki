import type { WorkflowFailureCause, WorkflowRunId, WorkflowRunStatus } from "@aiki/types/workflow-run";

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

export class WorkflowRunPausedError extends Error {
	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} paused`);
		this.name = "WorkflowRunPausedError";
	}
}

export class WorkflowRunCancelledError extends Error {
	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} cancelled`);
		this.name = "WorkflowRunCancelledError";
	}
}

export class WorkflowRunFailedError extends Error {
	constructor(
		public readonly id: WorkflowRunId,
		public readonly attempts: number,
		public readonly reason: string,
		public readonly failureCause?: WorkflowFailureCause,
	) {
		super(`Workflow ${id} failed after ${attempts} attempt(s): ${reason}`);
		this.name = "WorkflowRunFailedError";
	}
}

export class WorkflowSleepingError extends Error {
	constructor(public readonly id: WorkflowRunId) {
		super(`Workflow ${id} is sleeping until`);
		this.name = "WorkflowSleepingError";
	}
}
