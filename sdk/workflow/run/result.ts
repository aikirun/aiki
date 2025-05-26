import { withRetry } from "@lib/retry/strategy.ts";
import type { WorkflowRunRepository } from "./repository.ts";

export function initWorkflowRunResultHandle<Result>(
	params: {
		id: string,
		repository: WorkflowRunRepository;
	},
) {
	return new WorkflowRunResultHandleImpl<Result>(params.id, params.repository);
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

export interface WorkflowRunWaitSyncParams {
	maxDurationMs: number;
}

export interface WorkflowRunResultHandle<Result> {
	id: string;

	getResult: () => Promise<WorkflowRunResult<Result>>;

	// TODO only use in tests
	waitForStateSync<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;
}

class WorkflowRunResultHandleImpl<Result> implements WorkflowRunResultHandle<Result> {
	constructor(
		public readonly id: string,
		private readonly repository: WorkflowRunRepository,
	) {}

	public getResult(): Promise<WorkflowRunResult<Result>> {
		return this.repository.getResult(this.id);
	}

	public async waitForStateSync<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		// TODO choose proper default
		const delayMs = 100;

		const result = await withRetry(
			this.getResult,
			{
				type: "fixed",
				maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
				delayMs,
			},
			(result) => Promise.resolve(result.state !== state),
		).run();

		return result as U;
	}
}