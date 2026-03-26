import type { TaskAddress, TaskInfo } from "./task";
import type { ChildWorkflowRunInfo, WorkflowRunAddress } from "./workflow-run";

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
