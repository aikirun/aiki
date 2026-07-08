import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunStatus } from "@aikirun/types/workflow/run";
import type { TaskId, TaskName, TaskStatus } from "@aikirun/types/workflow/task";

export class WorkflowRunRevisionConflictError extends Error {
	public readonly workflowRunId: WorkflowRunId;
	public readonly expectedRevision: number;

	constructor(workflowRunId: WorkflowRunId, expectedRevision: number) {
		super(`Revision conflict for workflow ${workflowRunId}: expected ${expectedRevision}`);
		this.name = "WorkflowRunRevisionConflictError";
		this.workflowRunId = workflowRunId;
		this.expectedRevision = expectedRevision;
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
	public readonly definitionHash: string;
	public readonly referenceId?: string;

	constructor(params: { definitionHash: string; referenceId?: string }) {
		super(
			`Conflicting schedule already exists (definitionHash ${params.definitionHash}${
				params.referenceId ? `, referenceId ${params.referenceId}` : ""
			})`
		);
		this.name = "ScheduleConflictError";
		this.definitionHash = params.definitionHash;
		this.referenceId = params.referenceId;
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
