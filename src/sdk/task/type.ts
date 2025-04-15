import { MaybeField } from "../../common/object/type.ts";
import { RetryStrategy } from "../../common/retry/strategy.ts";
import { WorkflowRun } from "../workflow-run/index.ts";

export type TaskExecuteParams<Payload> = MaybeField<"payload", Payload>;

export interface TaskParams<Payload, Result> {
	name: string;
	run: (params: TaskExecuteParams<Payload>) => Promise<Result>;
	retry?: RetryStrategy;
}

export interface TaskRunParamsBase {
	idempotencyKey?: string;
	retry?: RetryStrategy;
}

export type TaskRunParams<Payload> = TaskRunParamsBase & MaybeField<"payload", Payload>;

export interface Task<Payload, Result> {
	run: <WorkflowPayload, WorkflowResult>(
		workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>,
		params: TaskRunParams<Payload>
	) => Promise<Result>;
}

export type TaskRunResult<Result> = 
	| {
		state: "none"
	}
	| {
		state: "completed";
		result: Result;
	}
	| {
		state: "failed";
		reason: string;
	};
