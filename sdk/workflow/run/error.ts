export class WorkflowRunConflictError extends Error {
	constructor(
		public readonly workflowRunId: string,
		public readonly operation: string,
		public readonly attempts: number,
	) {
		super(`Conflict while performing ${operation} on workflow ${workflowRunId} after ${attempts} attempts`);
		this.name = "WorkflowRunConflictError";
	}
}

export class WorkflowCancelledError extends Error {
	constructor(public readonly workflowRunId: string) {
		super(`Workflow ${workflowRunId} was cancelled`);
		this.name = "WorkflowCancelledError";
	}
}

export class WorkflowPausedError extends Error {
	constructor(public readonly workflowRunId: string) {
		super(`Workflow ${workflowRunId} was paused`);
		this.name = "WorkflowPausedError";
	}
}

export class WorkflowNotExecutableError extends Error {
	constructor(
		public readonly workflowRunId: string,
		public readonly currentState: string,
	) {
		super(`Workflow ${workflowRunId} is not executable (state: ${currentState})`);
		this.name = "WorkflowNotExecutableError";
	}
}
