import {
	type WorkflowRun,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	type WorkflowRunState,
	type WorkflowRunStateCancelled,
	type WorkflowRunStateCompleted,
	type WorkflowRunStateInComplete,
	type WorkflowRunStatePaused,
	type WorkflowRunStatus,
} from "@aikirun/types/workflow-run";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import type { TaskPath, TaskState } from "@aikirun/types/task";
import { INTERNAL } from "@aikirun/types/symbols";
import { withRetry } from "@aikirun/lib";

export function workflowRunHandle<Input, Output>(
	client: Client<unknown>,
	id: WorkflowRunId
): Promise<WorkflowRunHandle<Input, Output>>;

export function workflowRunHandle<Input, Output>(
	client: Client<unknown>,
	run: WorkflowRun<Input, Output>,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output>>;

export async function workflowRunHandle<Input, Output>(
	client: Client<unknown>,
	runOrId: WorkflowRunId | WorkflowRun<Input, Output>,
	logger?: Logger
): Promise<WorkflowRunHandle<Input, Output>> {
	const run =
		typeof runOrId !== "string"
			? runOrId
			: ((await client.api.workflowRun.getByIdV1({ id: runOrId })).run as WorkflowRun<Input, Output>);
	return new WorkflowRunHandleImpl(client.api, run, logger ?? client.logger.child({ "aiki.workflowRunId": run.id }));
}

export interface WorkflowRunHandle<Input, Output> {
	run: Readonly<WorkflowRun<Input, Output>>;

	refresh: () => Promise<void>;

	wait<S extends WorkflowRunStatus>(
		condition: { type: "status"; status: S },
		options: WorkflowRunWaitOptions
	): Promise<
		| { success: false; cause: "timeout" | "aborted" }
		| {
				success: true;
				state: S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete;
		  }
	>;
	wait(
		condition: { type: "event"; event: string },
		options: WorkflowRunWaitOptions
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: WorkflowRunState<Output> }>;

	cancel: (reason?: string) => Promise<void>;

	pause: () => Promise<void>;

	resume: () => Promise<void>;

	[INTERNAL]: {
		transitionState: (state: WorkflowRunState<Output>) => Promise<void>;
		transitionTaskState: (taskPath: TaskPath, taskState: TaskState<unknown>) => Promise<void>;
		assertExecutionAllowed: () => void;
	};
}

export interface WorkflowRunWaitOptions {
	maxDurationMs: number;
	pollIntervalMs?: number;
	abortSignal?: AbortSignal;
}

// TODO: check how frequently we refresh. Maybe we don't have to all the time
class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly [INTERNAL]: WorkflowRunHandle<Input, Output>[typeof INTERNAL];

	constructor(
		private readonly api: ApiClient,
		private _run: WorkflowRun<Input, Output>,
		private readonly logger: Logger
	) {
		this[INTERNAL] = {
			transitionState: this.transitionState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
			assertExecutionAllowed: this.assertExecutionAllowed.bind(this),
		};
	}

	public get run(): Readonly<WorkflowRun<Input, Output>> {
		return this._run;
	}

	public async refresh() {
		const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });
		this._run = currentRun as WorkflowRun<Input, Output>;
	}

	public async wait<
		S extends WorkflowRunStatus,
		R extends S extends "completed" ? WorkflowRunStateCompleted<Output> : WorkflowRunStateInComplete,
	>(
		condition: { type: "status"; status: S } | { type: "event"; event: string },
		options: WorkflowRunWaitOptions
	): Promise<{ success: false; cause: "timeout" | "aborted" } | { success: true; state: R }> {
		if (options.abortSignal?.aborted) {
			throw new Error("Wait operation aborted");
		}

		const delayMs = options.pollIntervalMs ?? 1_000;
		const maxAttempts = Math.ceil(options.maxDurationMs / delayMs);

		switch (condition.type) {
			case "status": {
				if (options.abortSignal !== undefined) {
					const maybeResult = await withRetry(
						async () => {
							await this.refresh();
							return this.run.state;
						},
						{ type: "fixed", maxAttempts, delayMs },
						{
							abortSignal: options.abortSignal,
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
					async () => {
						await this.refresh();
						return this.run.state;
					},
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

	public async cancel(reason?: string): Promise<void> {
		const state: WorkflowRunStateCancelled = { status: "cancelled", reason };
		const { newRevision } = await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state,
			expectedRevision: this.run.revision,
		});
		this._run.state = state;
		this._run.revision = newRevision;
	}

	public async pause(): Promise<void> {
		const state: WorkflowRunStatePaused = { status: "paused", pausedAt: Date.now() };
		const { newRevision } = await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state,
			expectedRevision: this.run.revision,
		});
		this._run.state = state;
		this._run.revision = newRevision;
	}

	public async resume(): Promise<void> {
		await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state: { status: "scheduled", scheduledAt: Date.now(), reason: "resume" },
			expectedRevision: this.run.revision,
		});
		await this.refresh();
	}

	private async transitionState(targetState: WorkflowRunState<Output>): Promise<void> {
		await this.api.workflowRun.transitionStateV1({
			id: this.run.id,
			state: targetState,
			expectedRevision: this.run.revision,
		});
		await this.refresh();
	}

	private async transitionTaskState(taskPath: TaskPath, taskState: TaskState<unknown>): Promise<void> {
		const { newRevision } = await this.api.workflowRun.transitionTaskStateV1({
			id: this.run.id,
			taskPath,
			taskState,
			expectedRevision: this.run.revision,
		});
		this._run.tasksState[taskPath] = taskState;
		this._run.revision = newRevision;
	}

	private assertExecutionAllowed() {
		const status = this.run.state.status;
		if (status !== "queued" && status !== "running") {
			throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, status);
		}
	}
}
