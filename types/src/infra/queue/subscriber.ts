import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Logger } from "@aikirun/lib/logger";

import type { WorkflowMeta } from "../../workflow";
import type { WorkflowRunId } from "../../workflow/run";

export interface WorkflowRunMessage {
	data: { id: WorkflowRunId };
}

export type SubscriberDelayParams = { type: "no_work" } | { type: "retry"; attemptNumber: number };

export interface Subscriber {
	getNextDelay: (params: SubscriberDelayParams) => number;
	getReadyRuns: (limit: number) => Promise<WorkflowRunMessage[]>;
	heartbeat?: (workflowRunId: WorkflowRunId) => Promise<void>;
	acknowledge?: (workflowRunId: WorkflowRunId) => Promise<void>;
}

export interface SubscriberContext {
	workerId: string;
	workflows: NonEmptyArray<WorkflowMeta>;
	shards?: string[];
	logger: Logger;
	signal: AbortSignal;
}

export type CreateSubscriber = (context: SubscriberContext) => Subscriber;
