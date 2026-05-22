import type { ChildWorkflowRunInfo, WorkflowRunAddress } from "./run";
import type { TaskAddress, TaskInfo } from "../task";

export interface ReplayManifest {
	consumeNextTask(address: TaskAddress): TaskInfo | undefined;

	consumeNextChildWorkflowRun(address: WorkflowRunAddress): ChildWorkflowRunInfo | undefined;

	hasUnconsumedEntries(): boolean;

	getUnconsumedEntries(): UnconsumedManifestEntries;
}

export interface UnconsumedManifestEntries {
	taskIds: string[];
	childWorkflowRunIds: string[];
}
