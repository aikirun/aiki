import type { WorkflowRun, WorkflowRunId, WorkflowRunState } from "@aiki/types/workflow-run";
import type { ApiClient, Logger } from "@aiki/types/client";
import type { TaskState } from "@aiki/types/task";
import { delay } from "@aiki/lib/async";
import { getRetryParams, type JitteredRetryStrategy } from "@aiki/lib/retry";
import { isServerConflictError } from "../../error.ts";
import {
	WorkflowRunCancelledError,
	WorkflowRunConflictError,
	WorkflowRunNotExecutableError,
	WorkflowRunPausedError,
} from "./error.ts";

export interface WorkflowRunHandleOptions {
	maxRetryAttempts?: number;
	retryBaseDelayMs?: number;
	retryMaxDelayMs?: number;
}

export function initWorkflowRunHandle<Input, Output>(
	api: ApiClient,
	run: WorkflowRun<Input, Output>,
	logger: Logger,
	options?: WorkflowRunHandleOptions,
): WorkflowRunHandle<Input, Output> {
	return new WorkflowRunHandleImpl(api, run, logger, options);
}

export interface WorkflowRunHandle<Input, Output> {
	run: WorkflowRun<Input, Output>;

	transitionState: (state: WorkflowRunState<Output>) => Promise<void>;

	_internal: {
		getTaskState: (taskPath: string) => TaskState<unknown>;
		transitionTaskState: (taskPath: string, taskState: TaskState<unknown>) => Promise<void>;
	};
}

class WorkflowRunHandleImpl<Input, Output> implements WorkflowRunHandle<Input, Output> {
	public readonly _internal: WorkflowRunHandle<Input, Output>["_internal"];
	private readonly options: Required<WorkflowRunHandleOptions>;

	constructor(
		private readonly api: ApiClient,
		public readonly run: WorkflowRun<Input, Output>,
		private readonly logger: Logger,
		options?: WorkflowRunHandleOptions,
	) {
		this.options = {
			maxRetryAttempts: options?.maxRetryAttempts ?? 3,
			retryBaseDelayMs: options?.retryBaseDelayMs ?? 50,
			retryMaxDelayMs: options?.retryMaxDelayMs ?? 1000,
		};

		this._internal = {
			getTaskState: this.getTaskState.bind(this),
			transitionTaskState: this.transitionTaskState.bind(this),
		};
	}

	public async transitionState(targetState: WorkflowRunState<Output>): Promise<void> {
		await this.withOptimisticRetry({
			name: "state-transition",
			maxAttempts: this.options.maxRetryAttempts,
			fn: async (revision) => {
				const { newRevision } = await this.api.workflowRun.transitionStateV1({
					id: this.run.id,
					state: targetState,
					expectedRevision: revision,
				});
				this.run.state = targetState;
				this.run.revision = newRevision;
			},
			shouldAbortOnConflict: (currentRun) => {
				if (currentRun.state.status === "cancelled") {
					throw new WorkflowRunCancelledError(this.run.id as WorkflowRunId);
				}
				if (currentRun.state.status === "paused") {
					throw new WorkflowRunPausedError(this.run.id as WorkflowRunId);
				}
				if (
					currentRun.state.status === "completed" ||
					currentRun.state.status === "failed"
				) {
					if (currentRun.state.status === targetState.status) {
						return true;
					}
					// trying to transition workflow away from a terminal state
					throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, currentRun.state.status);
				}
				if (
					this.run.state.status === "queued" &&
					targetState.status === "running" &&
					currentRun.state.status === "running"
				) {
					// Race condition: Another worker started the workflow
					throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, currentRun.state.status);
				}

				// Retryable conflict: State changed but transition may still be valid
				return false;
			},
		});
	}

	private getTaskState(taskPath: string): TaskState<unknown> {
		return this.run.tasksState[taskPath] ?? {
			status: "none",
		};
	}

	private async transitionTaskState(taskPath: string, targetTaskState: TaskState<unknown>): Promise<void> {
		await this.withOptimisticRetry(
			{
				name: "task-state-transition",
				maxAttempts: this.options.maxRetryAttempts,
				fn: async (revision) => {
					const { newRevision } = await this.api.workflowRun.transitionTaskStateV1({
						id: this.run.id,
						taskPath,
						taskState: targetTaskState,
						expectedRevision: revision,
					});
					this.run.tasksState[taskPath] = targetTaskState;
					this.run.revision = newRevision;
				},
				shouldAbortOnConflict: (currentRun) => {
					if (currentRun.state.status !== "running") {
						if (currentRun.state.status === "cancelled") {
							throw new WorkflowRunCancelledError(this.run.id as WorkflowRunId);
						}
						if (currentRun.state.status === "paused") {
							throw new WorkflowRunPausedError(this.run.id as WorkflowRunId);
						}
						throw new WorkflowRunNotExecutableError(this.run.id as WorkflowRunId, currentRun.state.status);
					}

					const currentTaskState = currentRun.tasksState[taskPath];
					if (currentTaskState?.status === "completed") {
						return true;
					}
					if (
						currentTaskState?.status === "running" &&
						targetTaskState.status === "running" &&
						currentTaskState.attempts >= targetTaskState.attempts
					) {
						// Another worker took over the task
						return true;
					}

					return false;
				},
			},
		);
	}

	private async withOptimisticRetry<T>(
		operation: {
			name: "state-transition" | "task-state-transition";
			maxAttempts: number;
			fn: (revision: number) => Promise<T>;
			shouldAbortOnConflict?: (currentRun: WorkflowRun<unknown, unknown>) => boolean;
		},
	): Promise<T | void> {
		const retryStrategy: JitteredRetryStrategy = {
			type: "jittered",
			maxAttempts: operation.maxAttempts,
			baseDelayMs: this.options.retryBaseDelayMs,
			maxDelayMs: this.options.retryMaxDelayMs,
		};

		let attempt = 0;

		while (attempt < retryStrategy.maxAttempts) {
			attempt++;

			try {
				return await operation.fn(this.run.revision);
			} catch (error) {
				if (!isServerConflictError(error)) {
					throw error;
				}

				this.logger.debug("Conflict detected, refetching workflow state", {
					"aiki.currentRevision": this.run.revision,
					"aiki.attempt": attempt,
					"aiki.maxAttempts": retryStrategy.maxAttempts,
					"aiki.operationName": operation.name,
				});

				const { run: currentRun } = await this.api.workflowRun.getByIdV1({ id: this.run.id });

				if (operation.shouldAbortOnConflict) {
					try {
						if (operation.shouldAbortOnConflict(currentRun)) {
							this.logger.info("Operation aborted", {
								"aiki.latestRevision": currentRun.revision,
								"aiki.operationName": operation.name,
							});
							this.updateInMemoryRun(currentRun);
							return;
						}
					} catch (error) {
						this.updateInMemoryRun(currentRun);
						throw error;
					}
				}

				this.updateInMemoryRun(currentRun);

				const retryParams = getRetryParams(attempt, retryStrategy);
				if (!retryParams.retriesLeft) {
					break;
				}

				this.logger.debug("Retrying operation with fresh state", {
					"aiki.latestRevision": currentRun.revision,
					"aiki.attempt": attempt,
					"aiki.operationName": operation.name,
				});

				await delay(retryParams.delayMs);
			}
		}

		this.logger.error("Max attempts exceeded due to conflicts", {
			"aiki.attempts": attempt,
			"aiki.operationName": operation.name,
		});
		throw new WorkflowRunConflictError(this.run.id as WorkflowRunId, operation.name, attempt);
	}

	private updateInMemoryRun(currentRun: WorkflowRun<unknown, unknown>) {
		this.run.tasksState = currentRun.tasksState;
		this.run.state = currentRun.state as WorkflowRunState<Output>;
		this.run.subWorkflowsRunState = currentRun.subWorkflowsRunState;
		this.run.revision = currentRun.revision;
	}
}
