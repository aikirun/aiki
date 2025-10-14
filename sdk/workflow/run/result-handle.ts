import { withRetry } from "@aiki/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunResult,
	WorkflowRunResultComplete,
	WorkflowRunResultInComplete,
	WorkflowRunStatus,
} from "@aiki/types/workflow-run";
import type { ApiClient } from "@aiki/types/client";

export function initWorkflowRunResultHandle<Output>(
	id: WorkflowRunId,
	api: ApiClient,
): WorkflowRunResultHandle<Output> {
	return new WorkflowRunResultHandleImpl<Output>(id, api);
}

export interface WorkflowRunWaitSyncParams {
	pollIntervalMs?: number;
	maxDurationMs: number;
}

export interface WorkflowRunResultHandle<Output> {
	id: string;

	getResult: () => Promise<WorkflowRunResult<Output>>;

	waitForStatus<
		T extends WorkflowRunStatus,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Output>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;
}

class WorkflowRunResultHandleImpl<Output> implements WorkflowRunResultHandle<Output> {
	constructor(
		public readonly id: string,
		private readonly api: ApiClient,
	) {}

	public async getResult(): Promise<WorkflowRunResult<Output>> {
		const response = await this.api.workflowRun.getResultV1({ id: this.id });
		return response.result as unknown as WorkflowRunResult<Output>;
	}

	public async waitForStatus<
		T extends WorkflowRunStatus,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Output>
			: WorkflowRunResultInComplete),
	>(status: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		const delayMs = params.pollIntervalMs ?? 100;

		const { result } = await withRetry(
			this.getResult.bind(this),
			{
				type: "fixed",
				maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
				delayMs,
			},
			{
				shouldRetryOnResult: (result) => Promise.resolve(result.status !== status),
			},
		).run();

		return result as U;
	}
}
