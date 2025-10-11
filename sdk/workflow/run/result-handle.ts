import { withRetry } from "@aiki/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunResult,
	WorkflowRunResultComplete,
	WorkflowRunResultInComplete,
	WorkflowRunState,
} from "@aiki/contract/workflow-run";
import type { ApiClient } from "../../client/client.ts";

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

	waitForState<
		T extends WorkflowRunState,
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

	public async waitForState<
		T extends WorkflowRunState,
		U extends (T extends "completed" ? WorkflowRunResultComplete<Output>
			: WorkflowRunResultInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		const delayMs = params.pollIntervalMs ?? 100;

		const { result } = await withRetry(
			this.getResult.bind(this),
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
