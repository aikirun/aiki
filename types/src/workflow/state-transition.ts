import type { WorkflowRunState } from "./run";
import type { TaskState } from "./task";

export interface WorkflowRunStateTransition {
	id: string;
	createdAt: number;
	type: "workflow_run";
	attempt: number;
	state: WorkflowRunState;
}

export interface TaskStateTransition {
	id: string;
	createdAt: number;
	type: "task";
	attempt: number;
	taskId: string;
	taskState: TaskState;
}
