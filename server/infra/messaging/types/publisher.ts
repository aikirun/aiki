import type { Context } from "server/middleware/context";

export interface WorkflowRunReadyMessage {
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface WorkflowRunPublisher {
	publishReadyRuns(context: Context, runs: WorkflowRunReadyMessage[]): Promise<void>;
}
