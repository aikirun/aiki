import type { BrandedString } from "@aiki/lib/string";
import type { TriggerStrategy } from "@aiki/lib/trigger";
import type { TaskRunResult } from "../task-run/types.ts";
import type { WorkflowName, WorkflowVersionId } from "../workflow/types.ts";

export type WorkflowRunId = BrandedString<"workflow_run_id">;

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

export interface WorkflowOptions {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
	shardKey?: string;
}

export interface WorkflowRunResultInComplete {
	state: Exclude<WorkflowRunState, "completed">;
}

export interface WorkflowRunResultComplete<Result> {
	state: "completed";
	result: Result;
}

export type WorkflowRunResult<Result> =
	| WorkflowRunResultInComplete
	| WorkflowRunResultComplete<Result>;

export interface WorkflowRunRow<Payload, Result> {
	id: WorkflowRunId;
	name: WorkflowName;
	versionId: WorkflowVersionId;
	payload: Payload;
	options: WorkflowOptions;
	result: WorkflowRunResult<Result>;
	subTasksRunResult: Record<string, TaskRunResult<unknown>>;
	subWorkflowsRunResult: Record<string, WorkflowRunResult<unknown>>;
}
