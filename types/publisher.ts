import type { NonEmptyArray } from "./array";

export interface WorkflowRunReadyMessage {
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface Publisher {
	publishReadyRuns(runs: NonEmptyArray<WorkflowRunReadyMessage>): Promise<void>;
}
