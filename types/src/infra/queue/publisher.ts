import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Logger } from "@aikirun/lib/logger";

export interface ReadyWorkflowRun {
	namespaceId: string;
	id: string;
	name: string;
	versionId: string;
	rank: number;
	shard?: string;
}

export interface PublishResult {
	/** Delivered. */
	published: ReadyWorkflowRun[];
	/** Deliverable, but withheld by policy (admission, fairness, throttling). */
	deferred: ReadyWorkflowRun[];
	/** Could not be delivered, or delivery is uncertain. */
	failed: ReadyWorkflowRun[];
	/** Not handled. */
	declined: ReadyWorkflowRun[];
}

export interface Publisher {
	publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<PublishResult>;
}

export interface PublisherContext {
	logger: Logger;
	signal: AbortSignal;
}

export type CreatePublisher = (context: PublisherContext) => Publisher;
