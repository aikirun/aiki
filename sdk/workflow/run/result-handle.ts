import { withRetry } from "@aiki/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunResult,
	WorkflowRunResultComplete,
	WorkflowRunResultInComplete,
	WorkflowRunState,
} from "@aiki/types/workflow";
import type { Client } from "@aiki/sdk/client";

export function initWorkflowRunResultHandle<Result>(
	id: WorkflowRunId,
	api: Client["api"],
): WorkflowRunResultHandle<Result> {
	return new WorkflowRunResultHandleImpl<Result>(id, api);
}

export interface WorkflowRunWaitSyncParams {
	pollIntervalMs?: number;
	maxDurationMs: number;
}

export interface WorkflowRunResultHandle<Result> {
	id: string;

	getResult: () => Promise<WorkflowRunResult<Result>>;

	waitForState<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;
}

class WorkflowRunResultHandleImpl<Result> implements WorkflowRunResultHandle<Result> {
	constructor(
		public readonly id: string,
		private readonly api: Client["api"],
	) {}

	public async getResult(): Promise<WorkflowRunResult<Result>> {
		const result = await this.api.workflowRun.getResultV1.query({ id: this.id });
		return result as WorkflowRunResult<Result>;
	}

	public async waitForState<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		const delayMs = params.pollIntervalMs ?? 100;

		const { result } = await withRetry(
			this.getResult,
			{
				type: "fixed",
				maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
				delayMs,
			},
			{
				shouldRetryOnResult: (result) => Promise.resolve(result.state !== state),
			},
		).run();

		return result as U;
	}
}
