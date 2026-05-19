import type { NonEmptyArray } from "@aikirun/lib/array";

import type { Logger } from "./logger";
import type { WorkflowMeta } from "./workflow";
import type { WorkflowRunId } from "./workflow-run";

export interface WorkflowRunMessage {
	data: { id: WorkflowRunId };
}

export type SubscriberDelayParams = { type: "no_work" } | { type: "retry"; attemptNumber: number };

export interface Subscriber {
	getNextDelay: (context: SubscriberDelayParams) => number;
	getReadyRuns: (size: number, options?: { abortSignal?: AbortSignal }) => Promise<WorkflowRunMessage[]>;
	heartbeat?: (workflowRunId: WorkflowRunId) => Promise<void>;
	acknowledge?: (workflowRunId: WorkflowRunId) => Promise<void>;
	close?: () => Promise<void>;
}

export interface SubscriberContext {
	workerId: string;
	workflows: NonEmptyArray<WorkflowMeta>;
	shards?: string[];
	logger: Logger;
}

export type CreateSubscriber = (context: SubscriberContext) => Subscriber | Promise<Subscriber>;
