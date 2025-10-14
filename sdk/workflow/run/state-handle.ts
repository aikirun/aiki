import { withRetry } from "@aiki/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateComplete,
	WorkflowRunStateInComplete,
	WorkflowRunStatus,
} from "@aiki/types/workflow-run";
import type { ApiClient } from "@aiki/types/client";

export function initWorkflowRunStateHandle<Output>(
	id: WorkflowRunId,
	api: ApiClient,
): WorkflowRunStateHandle<Output> {
	return new WorkflowRunStateHandleImpl<Output>(id, api);
}

export interface WorkflowRunWaitSyncParams {
	pollIntervalMs?: number;
	maxDurationMs: number;
}

export interface WorkflowRunStateHandle<Output> {
	id: string;

	getState: () => Promise<WorkflowRunState<Output>>;

	waitForStatus<
		T extends WorkflowRunStatus,
		U extends (T extends "completed" ? WorkflowRunStateComplete<Output>
			: WorkflowRunStateInComplete),
	>(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;
}

class WorkflowRunStateHandleImpl<Output> implements WorkflowRunStateHandle<Output> {
	constructor(
		public readonly id: string,
		private readonly api: ApiClient,
	) {}

	public async getState(): Promise<WorkflowRunState<Output>> {
		const response = await this.api.workflowRun.getStateV1({ id: this.id });
		return response.state as unknown as WorkflowRunState<Output>;
	}

	public async waitForStatus<
		T extends WorkflowRunStatus,
		U extends (T extends "completed" ? WorkflowRunStateComplete<Output>
			: WorkflowRunStateInComplete),
	>(status: T, params: WorkflowRunWaitSyncParams): Promise<U> {
		const delayMs = params.pollIntervalMs ?? 100;

		const { result: state } = await withRetry(
			this.getState.bind(this),
			{
				type: "fixed",
				maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
				delayMs,
			},
			{
				shouldRetryOnResult: (state) => Promise.resolve(state.status !== status),
			},
		).run();

		return state as U;
	}
}
