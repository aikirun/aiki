import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Logger } from "@aikirun/lib/logger";

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

export interface PublisherContext {
	logger: Logger;
}

export type CreatePublisher = (context: PublisherContext) => Publisher | Promise<Publisher>;
