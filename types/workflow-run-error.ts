import type { UnconsumedManifestEntries } from "./replay-manifest";
import type { WorkflowRunId, WorkflowRunStatus } from "./workflow-run";

export class WorkflowRunNotExecutableError extends Error {
	public readonly id: WorkflowRunId;
	public readonly status: WorkflowRunStatus;

	constructor(id: WorkflowRunId, status: WorkflowRunStatus) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.name = "WorkflowRunNotExecutableError";
		this.id = id;
		this.status = status;
	}
}

export class WorkflowRunSuspendedError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} is suspended`);
		this.name = "WorkflowRunSuspendedError";
		this.id = id;
	}
}

export class WorkflowRunFailedError extends Error {
	public readonly id: WorkflowRunId;
	public readonly attempts: number;
	public readonly reason?: string;

	constructor(id: WorkflowRunId, attempts: number, reason?: string) {
		const message = reason
			? `Workflow ${id} failed after ${attempts} attempt(s): ${reason}`
			: `Workflow ${id} failed after ${attempts} attempt(s)`;
		super(message);
		this.name = "WorkflowRunFailedError";
		this.id = id;
		this.attempts = attempts;
		this.reason = reason;
	}
}

export class WorkflowRunRevisionConflictError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Conflict while trying to update Workflow run ${id}`);
		this.name = "WorkflowRunRevisionConflictError";
		this.id = id;
	}
}

export class NonDeterminismError extends Error {
	public readonly id: WorkflowRunId;
	public readonly attempts: number;
	public readonly unconsumedManifestEntries: UnconsumedManifestEntries;

	constructor(
		id: WorkflowRunId,
		attempts: number,
		unconsumedManifestEntries: { taskIds: string[]; childWorkflowRunIds: string[] }
	) {
		super(`Replay divergence for Workflow run ${id}`);
		this.name = "NonDeterminismError";
		this.id = id;
		this.attempts = attempts;
		this.unconsumedManifestEntries = unconsumedManifestEntries;
	}
}
