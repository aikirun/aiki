import { withRetry } from "@aiki/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunResult,
	WorkflowRunResultComplete,
	WorkflowRunResultInComplete,
	WorkflowRunState,
} from "@aiki/contract/workflow-run";
import type { Client } from "../../client/client.ts";

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
		const response = await this.api.workflowRun.getResultV1({ id: this.id });
		return response.result as unknown as WorkflowRunResult<Result>;
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
