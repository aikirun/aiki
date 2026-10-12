import type { UnconsumedManifestEntries } from "./replay-manifest";
import type { WorkflowRunId, WorkflowRunStatus } from "./run";
import type { TaskName } from "../task";
import type { WorkflowName, WorkflowVersionId } from "../workflow";

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

/**
 * A request the run's execution made got no definite answer, so the execution cannot tell what
 * the server recorded. The run is left for recovery, which replays it from what the server has.
 */
export class WorkflowRunStateUnknownError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId, cause: unknown) {
		super(`The state of workflow run ${id} is unknown`, { cause });
		this.name = "WorkflowRunStateUnknownError";
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

export class ClientCodecMissingError extends Error {
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} expects a client codec, but none present`);
		this.name = "ClientCodecMissingError";
		this.id = id;
	}
}

/**
 * Indicates that a child start asked to skip the client codec while its parent run already applied one.
 * Children of an encoded parent must keep the same declaration.
 */
export class ChildWorkflowRunClientCodecSkippedError extends Error {
	public readonly parentId: WorkflowRunId;
	public readonly childWorkflowName: WorkflowName;
	public readonly childWorkflowVersionId: WorkflowVersionId;

	constructor(parentId: WorkflowRunId, childWorkflowName: WorkflowName, childWorkflowVersionId: WorkflowVersionId) {
		super(
			`Child workflow ${childWorkflowName}:${childWorkflowVersionId} cannot skip the client codec when parent run ${parentId} applied it`
		);
		this.name = "ChildWorkflowRunClientCodecSkippedError";
		this.parentId = parentId;
		this.childWorkflowName = childWorkflowName;
		this.childWorkflowVersionId = childWorkflowVersionId;
	}
}

/**
 * A task handler used the workflow run: it started a task or a child workflow, slept, or waited
 * for an event or a child workflow. Only the workflow handler can do these. The task and the run
 * fail, and the task is not retried.
 */
export class WorkflowRunUsedInTaskHandlerError extends Error {
	public readonly id: WorkflowRunId;
	public readonly taskName: TaskName;

	constructor(id: WorkflowRunId, taskName: TaskName) {
		super(`Task ${taskName} cannot use workflow run ${id} inside its handler`);
		this.name = "WorkflowRunUsedInTaskHandlerError";
		this.id = id;
		this.taskName = taskName;
	}
}
