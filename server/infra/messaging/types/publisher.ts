import type { NonEmptyArray } from "@aikirun/lib/array";

export interface WorkflowRunReadyMessage {
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface WorkflowRunPublisher {
	publishReadyRuns(runs: NonEmptyArray<WorkflowRunReadyMessage>): Promise<void>;
}
