import type { NonEmptyArray } from "@aikirun/lib/array";

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
