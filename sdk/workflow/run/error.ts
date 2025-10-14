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
