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

export type PublishResultBucket = Array<{ run: ReadyWorkflowRun }>;
export type TimedPublishResultBucket = Array<{ run: ReadyWorkflowRun; nextPublishAttemptAt: number }>;

export interface PublishResult {
	/** Handoff to broker confirmed. */
	published?: PublishResultBucket;
	/** Deliverable, but withheld by policy (admission, fairness, throttling). */
	deferred?: TimedPublishResultBucket;
	/** Delivery failure. */
	failed?: PublishResultBucket;
	/** Not handled. */
	declined?: PublishResultBucket;
}

export interface Publisher {
	publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<PublishResult>;
}

export interface PublisherContext {
	logger: Logger;
	signal: AbortSignal;
}

export type CreatePublisher = (context: PublisherContext) => Publisher;
