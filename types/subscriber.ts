import type { Logger } from "./logger";
import type { WorkflowMeta } from "./workflow";
import type { WorkflowRunId } from "./workflow-run";

export interface WorkflowRunBatch {
	data: { workflowRunId: WorkflowRunId };
}

export type SubscriberDelayParams =
	| { type: "polled"; foundWork: boolean }
	| { type: "retry"; attemptNumber: number }
	| { type: "heartbeat" }
	| { type: "at_capacity" };

export interface Subscriber {
	getNextDelay: (context: SubscriberDelayParams) => number;
	getNextBatch: (size: number) => Promise<WorkflowRunBatch[]>;
	heartbeat?: (workflowRunId: WorkflowRunId) => Promise<void>;
	acknowledge?: (workflowRunId: WorkflowRunId) => Promise<void>;
	close?: () => Promise<void>;
}

export interface SubscriberContext {
	workerId: string;
	workflows: WorkflowMeta[];
	shards?: string[];
	logger: Logger;
}

export type CreateSubscriber = (context: SubscriberContext) => Subscriber | Promise<Subscriber>;
