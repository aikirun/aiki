import { withRetry } from "@aikirun/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateCompleted,
	WorkflowRunStateInComplete,
	WorkflowRunStatus,
} from "@aikirun/types/workflow-run";
import type { ApiClient } from "@aikirun/types/client";

export function initWorkflowRunStateHandle<Output>(id: WorkflowRunId, api: ApiClient): WorkflowRunStateHandle<Output> {
	return new WorkflowRunStateHandleImpl<Output>(id, api);
}

export interface WorkflowRunWaitSyncParams {
	maxDurationMs: number;
	pollIntervalMs?: number;
	abortSignal?: AbortSignal;
}

export interface WorkflowRunStateHandle<Output> {
	id: string;

	getState: () => Promise<WorkflowRunState<Output>>;

	wait<S extends WorkflowRunStatus>(
		condition: { type: "status"; status: S },
		params: WorkflowRunWaitSyncParams
	): Promise<
		| { success: false; cause: "timeout" | "aborted" }
		| {
				success: true;
				state: S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete;
		  }
	>;
	wait(
		condition: { type: "event"; event: string },
		params: WorkflowRunWaitSyncParams
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: WorkflowRunState<Output> }>;
}

class WorkflowRunStateHandleImpl<Output> implements WorkflowRunStateHandle<Output> {
	constructor(
		public readonly id: string,
		private readonly api: ApiClient
	) {}

	public async getState(): Promise<WorkflowRunState<Output>> {
		const response = await this.api.workflowRun.getStateV1({ id: this.id });
		return response.state as unknown as WorkflowRunState<Output>;
	}

	public async wait<
		S extends WorkflowRunStatus,
		R extends S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete,
	>(
		condition: { type: "status"; status: S } | { type: "event"; event: string },
		params: WorkflowRunWaitSyncParams
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: R }> {
		if (params.abortSignal?.aborted) {
			throw new Error("Wait operation aborted");
		}

		const delayMs = params.pollIntervalMs ?? 1_000;
		const maxAttempts = Math.ceil(params.maxDurationMs / delayMs);

		switch (condition.type) {
			case "status": {
				if (params.abortSignal !== undefined) {
					const maybeResult = await withRetry(
						this.getState.bind(this),
						{ type: "fixed", maxAttempts, delayMs },
						{
							abortSignal: params.abortSignal,
							shouldRetryOnResult: (state) => Promise.resolve(state.status !== condition.status),
						}
					).run();
					if (maybeResult.state === "timeout" || maybeResult.state === "aborted") {
						return { success: false, cause: maybeResult.state };
					}
					return {
						success: true,
						state: maybeResult.result as R,
					};
				} else {
					const maybeResult = await withRetry(
						this.getState.bind(this),
						{ type: "fixed", maxAttempts, delayMs },
						{ shouldRetryOnResult: (state) => Promise.resolve(state.status !== condition.status) }
					).run();
					if (maybeResult.state === "timeout") {
						return { success: false, cause: maybeResult.state };
					}
					return {
						success: true,
						state: maybeResult.result as R,
					};
				}
			}
			case "event": {
				throw new Error("Event-based waiting is not yet implemented");
			}
			default:
				return condition satisfies never;
		}
	}
}
