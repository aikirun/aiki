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

export type PublishRunsResultBucket = Array<{ run: ReadyWorkflowRun }>;
export type TimedPublishRunsResultBucket = Array<{ run: ReadyWorkflowRun; nextPublishAttemptAt: number }>;

export interface PublishRunsResult {
	/** Handoff to broker confirmed. */
	published?: PublishRunsResultBucket;
	/** Deliverable, but withheld by policy (admission, fairness, throttling). */
	deferred?: TimedPublishRunsResultBucket;
	/** Delivery failure. */
	failed?: PublishRunsResultBucket;
	/** Not handled. */
	declined?: PublishRunsResultBucket;
}

export interface Publisher {
	publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<PublishRunsResult>;
}

export interface PublisherContext {
	logger: Logger;
	signal: AbortSignal;
}

export type CreatePublisher = (context: PublisherContext) => Publisher;
