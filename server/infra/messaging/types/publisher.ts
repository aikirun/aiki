import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Context } from "server/middleware/context";

export interface WorkflowRunReadyMessage {
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface WorkflowRunPublisher {
	publishReadyRuns(context: Context, runs: NonEmptyArray<WorkflowRunReadyMessage>): Promise<void>;
}
