import type { BrandedString } from "@lib/string/types.ts";
import type { MaybeField } from "@lib/object/mod.ts";
import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { TaskRunResult } from "./task-run.ts";

export type WorkflowRunId = BrandedString<"workflow_run_id">;

export type WorkflowRunParams<Payload> = MaybeField<"payload", Payload> & {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	/**
	 * Optional shard key for distributing workflows across sharded streams.
	 * When provided, the workflow will be routed to stream: workflow:${workflowName}:${shard}
	 * When omitted, the workflow uses the default stream: workflow:${workflowName}
	 */
	shard?: string;
};

export interface WorkflowRunRow<Payload, Result> {
	id: WorkflowRunId;
	name: string;
	versionId: string;
	params: WorkflowRunParams<Payload>;
	result: WorkflowRunResult<Result>;
	subTasksRunResult: Record<string, TaskRunResult<unknown>>;
	subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>;
}

export type WorkflowRunResult<Result> =
	| WorkflowRunResultInComplete
	| WorkflowRunResultComplete<Result>;

export interface WorkflowRunResultInComplete {
	state: Exclude<WorkflowRunState, "completed">;
}

export interface WorkflowRunResultComplete<Result> {
	state: "completed";
	result: Result;
}

// TODO: revise these states
export type WorkflowRunState =
	| "scheduled"
	| "queued"
	| "starting"
	| "running"
	| "paused"
	| "sleeping"
	| "awaiting_event"
	| "awaiting_retry"
	| "awaiting_sub_workflow"
	| "cancelled"
	| "failed"
	| "completed";
