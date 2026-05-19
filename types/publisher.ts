import type { NonEmptyArray } from "./array";

export interface ReadyWorkflowRun {
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface Publisher {
	publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<void>;
}
