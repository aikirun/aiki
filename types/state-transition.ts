import type { TaskState } from "./task";
import type { WorkflowRunState } from "./workflow-run";

export const STATE_TRANSITION_TYPES = ["workflow_run", "task"] as const;
export type StateTransitionType = (typeof STATE_TRANSITION_TYPES)[number];

export interface StateTransitionBase {
	id: string;
	createdAt: number;
	type: StateTransitionType;
}

export interface WorkflowRunStateTransition extends StateTransitionBase {
	type: "workflow_run";
	state: WorkflowRunState;
}

export interface TaskStateTransition extends StateTransitionBase {
	type: "task";
	taskId: string;
	taskState: TaskState;
}

export type StateTransition = WorkflowRunStateTransition | TaskStateTransition;
