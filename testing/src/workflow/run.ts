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

export const runningWorkflowRunRecordFactory = Factory.define<WorkflowRunRecord & { state: WorkflowRunStateRunning }>(
	({ sequence }) => ({
		id: `run-${sequence}`,
		name: "workflow",
		versionId: "1.0.0",
		createdAt: 0,
		revision: 0,
		stateTransitionId: "transition",
		inputHash: "hash",
		attempts: 1,
		state: { status: "running" },
		taskQueues: {},
		sleepQueues: {},
		eventWaitQueues: {},
		childWorkflowRunQueues: {},
	})
);
