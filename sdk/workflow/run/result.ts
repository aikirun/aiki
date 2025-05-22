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
