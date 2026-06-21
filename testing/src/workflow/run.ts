import type { ChildWorkflowRunInfo, WorkflowRunRecord, WorkflowRunStateRunning } from "@aikirun/types/workflow/run";
import { Factory } from "fishery";

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
