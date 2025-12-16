import { withRetry } from "@aikirun/lib/retry";
import type {
	WorkflowRunId,
	WorkflowRunState,
	WorkflowRunStateCompleted,
	WorkflowRunStateInComplete,
	WorkflowRunStatus,
} from "@aikirun/types/workflow-run";
import type { ApiClient, Logger } from "@aikirun/types/client";

export function initWorkflowRunStateHandle<Output>(
	id: WorkflowRunId,
	api: ApiClient,
	logger: Logger
): WorkflowRunStateHandle<Output> {
	return new WorkflowRunStateHandleImpl<Output>(id, api, logger);
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

	cancel: (reason?: string) => Promise<{ success: boolean }>;

	wake: () => Promise<{ success: boolean }>;
}

class WorkflowRunStateHandleImpl<Output> implements WorkflowRunStateHandle<Output> {
	private revision: number | undefined;

	constructor(
		public readonly id: string,
		private readonly api: ApiClient,
		private readonly logger: Logger
	) {}

	public async getState(): Promise<WorkflowRunState<Output>> {
		const { run } = await this.api.workflowRun.getByIdV1({ id: this.id });
		this.revision = run.revision;
		return run.state as unknown as WorkflowRunState<Output>;
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
				}

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
			case "event": {
				throw new Error("Event-based waiting is not yet implemented");
			}
			default:
				return condition satisfies never;
		}
	}

	public async cancel(reason?: string): Promise<{ success: false } | { success: true }> {
		try {
			if (this.revision === undefined) {
				const { run } = await this.api.workflowRun.getByIdV1({ id: this.id });
				this.revision = run.revision;

				if (run.state.status === "cancelled") {
					return { success: true };
				}
			}
			await this.api.workflowRun.transitionStateV1({
				id: this.id,
				state: { status: "cancelled", reason },
				expectedRevision: this.revision,
			});
			return { success: true };
		} catch (error) {
			this.logger.warn("Could not cancel workflow run", {
				"aiki.workflowRunId": this.id,
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
			return { success: false };
		}
	}

	public async wake(): Promise<{ success: boolean }> {
		try {
			if (this.revision === undefined) {
				const { run } = await this.api.workflowRun.getByIdV1({ id: this.id });
				this.revision = run.revision;
			}
			await this.api.workflowRun.transitionStateV1({
				id: this.id,
				state: { status: "scheduled", scheduledAt: Date.now() },
				expectedRevision: this.revision,
			});
			return { success: true };
		} catch (error) {
			this.logger.warn("Could not wake workflow run", {
				"aiki.workflowRunId": this.id,
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
			return { success: false };
		}
	}
}
