import type { UnconsumedManifestEntries } from "./replay-manifest";
import type { WorkflowRunId, WorkflowRunStatus } from "./run";
import type { TaskName } from "../task";
import type { WorkflowName, WorkflowVersionId } from "../workflow";

export class WorkflowRunNotExecutableError extends Error {
	public override readonly name = "WorkflowRunNotExecutableError";
	public readonly id: WorkflowRunId;
	public readonly status: WorkflowRunStatus;

	constructor(id: WorkflowRunId, status: WorkflowRunStatus) {
		super(`Workflow ${id} is not executable while ${status}`);
		this.id = id;
		this.status = status;
	}
}

export class WorkflowRunSuspendedError extends Error {
	public override readonly name = "WorkflowRunSuspendedError";
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} is suspended`);
		this.id = id;
	}
}

export class WorkflowRunFailedError extends Error {
	public override readonly name = "WorkflowRunFailedError";
	public readonly id: WorkflowRunId;
	public readonly attempts: number;
	public readonly reason?: string;

	constructor(id: WorkflowRunId, attempts: number, reason?: string) {
		const message = reason
			? `Workflow ${id} failed after ${attempts} attempt(s): ${reason}`
			: `Workflow ${id} failed after ${attempts} attempt(s)`;
		super(message);
		this.id = id;
		this.attempts = attempts;
		this.reason = reason;
	}
}

export class WorkflowRunRevisionConflictError extends Error {
	public override readonly name = "WorkflowRunRevisionConflictError";
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Conflict while trying to update Workflow run ${id}`);
		this.id = id;
	}
}

/**
 * A request the run's execution made got no definite answer, so the execution cannot tell what
 * the server recorded. The run is left for recovery, which replays it from what the server has.
 */
export class WorkflowRunStateUnknownError extends Error {
	public override readonly name = "WorkflowRunStateUnknownError";
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId, cause: unknown) {
		super(`The state of workflow run ${id} is unknown`, { cause });
		this.id = id;
	}
}

export class NonDeterminismError extends Error {
	public override readonly name = "NonDeterminismError";
	public readonly id: WorkflowRunId;
	public readonly attempts: number;
	public readonly unconsumedManifestEntries: UnconsumedManifestEntries;

	constructor(
		id: WorkflowRunId,
		attempts: number,
		unconsumedManifestEntries: { taskIds: string[]; childWorkflowRunIds: string[] }
	) {
		super(`Replay divergence for Workflow run ${id}`);
		this.id = id;
		this.attempts = attempts;
		this.unconsumedManifestEntries = unconsumedManifestEntries;
	}
}

export class ClientCodecMissingError extends Error {
	public override readonly name = "ClientCodecMissingError";
	public readonly id: WorkflowRunId;

	constructor(id: WorkflowRunId) {
		super(`Workflow ${id} expects a client codec, but none present`);
		this.id = id;
	}
}

/**
 * The client's codec threw while encoding a payload. The codec's error is the `cause`. In a
 * workflow, this error ends the execution even when the workflow code catches it, and the run is
 * left for a worker whose codec can encode the payload.
 */
export class ClientCodecEncodeFailedError extends Error {
	public override readonly name = "ClientCodecEncodeFailedError";

	constructor(cause: unknown) {
		super("The client codec failed to encode a payload", { cause });
	}
}

/**
 * The client's codec threw while decoding a payload. The codec's error is the `cause`. In a
 * workflow, this error ends the execution even when the workflow code catches it, and the run is
 * left for a worker whose codec can decode the payload.
 */
export class ClientCodecDecodeFailedError extends Error {
	public override readonly name = "ClientCodecDecodeFailedError";

	constructor(cause: unknown) {
		super("The client codec failed to decode a payload", { cause });
	}
}

/**
 * Indicates that a child start asked to skip the client codec while its parent run already applied one.
 * Children of an encoded parent must keep the same declaration.
 */
export class ChildWorkflowRunClientCodecSkippedError extends Error {
	public override readonly name = "ChildWorkflowRunClientCodecSkippedError";
	public readonly parentId: WorkflowRunId;
	public readonly childWorkflowName: WorkflowName;
	public readonly childWorkflowVersionId: WorkflowVersionId;

	constructor(parentId: WorkflowRunId, childWorkflowName: WorkflowName, childWorkflowVersionId: WorkflowVersionId) {
		super(
			`Child workflow ${childWorkflowName}:${childWorkflowVersionId} cannot skip the client codec when parent run ${parentId} applied it`
		);
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
	public override readonly name = "WorkflowRunUsedInTaskHandlerError";
	public readonly id: WorkflowRunId;
	public readonly taskName: TaskName;

	constructor(id: WorkflowRunId, taskName: TaskName) {
		super(`Task ${taskName} cannot use workflow run ${id} inside its handler`);
		this.id = id;
		this.taskName = taskName;
	}
}
