import type {
	ChildWorkflowRunInfo,
	WorkflowRunRecord,
	WorkflowRunState,
	WorkflowRunStatePaused,
	WorkflowRunStateRunning,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { Factory } from "fishery";

export const workflowRunStateByStatus: {
	[Status in WorkflowRunStatus]: Extract<WorkflowRunState, { status: Status }>;
} = {
	scheduled: { status: "scheduled", scheduledAt: 0, reason: "new" },
	queued: { status: "queued", reason: "new" },
	running: { status: "running" },
	paused: { status: "paused" },
	sleeping: { status: "sleeping", sleepName: "nap", awakeAt: 0 },
	awaiting_event: { status: "awaiting_event", eventName: "order-shipped" },
	awaiting_retry: {
		status: "awaiting_retry",
		cause: "self",
		nextAttemptAt: 0,
		error: { name: "Error", message: "boom" },
	},
	awaiting_child_workflow: {
		status: "awaiting_child_workflow",
		childWorkflowRunId: "child-1",
		childWorkflowRunStatus: "completed",
	},
	cancelled: { status: "cancelled" },
	completed: { status: "completed", output: undefined },
	failed: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
};

export const childWorkflowRunInfoFactory = Factory.define<ChildWorkflowRunInfo>(({ sequence }) => ({
	id: `child-run-${sequence}`,
	name: "child-run",
	versionId: "1.0.0",
	inputHash: "hash",
	childWorkflowRunWaitQueues: {
		cancelled: { childWorkflowRunWaits: [] },
		completed: { childWorkflowRunWaits: [] },
		failed: { childWorkflowRunWaits: [] },
	},
}));

const baseWorkflowRunRecord = (sequence: number): Omit<WorkflowRunRecord, "state"> => ({
	id: `run-${sequence}`,
	name: "workflow",
	versionId: "1.0.0",
	createdAt: 0,
	revision: 0,
	stateTransitionId: "transition",
	inputHash: "hash",
	attempts: 1,
	taskQueues: {},
	sleepQueues: {},
	eventWaitQueues: {},
	childWorkflowRunQueues: {},
});

export const baseWorkflowRunRecordFactory = Factory.define<Omit<WorkflowRunRecord, "state">>(({ sequence }) =>
	baseWorkflowRunRecord(sequence)
);

export const runningWorkflowRunRecordFactory = Factory.define<WorkflowRunRecord & { state: WorkflowRunStateRunning }>(
	({ sequence }) => ({ ...baseWorkflowRunRecord(sequence), state: { status: "running" } })
);

export const pausedWorkflowRunRecordFactory = Factory.define<WorkflowRunRecord & { state: WorkflowRunStatePaused }>(
	({ sequence }) => ({ ...baseWorkflowRunRecord(sequence), state: { status: "paused" } })
);
