import type { WorkflowRun, WorkflowRunState } from "@aiki/types/workflow-run";
import type { ApiClient, Logger } from "@aiki/types/client";
import type { TaskState } from "@aiki/types/task";
import { delay } from "@aiki/lib/async";
import { getRetryParams, type JitteredRetryStrategy } from "@aiki/lib/retry";
import { isServerConflictError } from "../../error.ts";
import { WorkflowRunConflictError } from "./error.ts";

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

	public async transitionState(state: WorkflowRunState<Output>): Promise<void> {
		await this.withOptimisticRetry({
			name: "state-transition",
			fn: async (revision) => {
				const { newRevision } = await this.api.workflowRun.transitionStateV1({
					id: this.run.id,
					state,
					expectedRevision: revision,
				});
				this.run.state = state;
				this.run.revision = newRevision;
			},
		});
	}

	private getTaskState(taskPath: string): TaskState<unknown> {
		return this.run.tasksState[taskPath] ?? {
			status: "none",
		};
	}

	private async transitionTaskState(taskPath: string, taskState: TaskState<unknown>): Promise<void> {
		await this.withOptimisticRetry(
			{
				name: "task-state-transition",
				fn: async (revision) => {
					const { newRevision } = await this.api.workflowRun.transitionTaskStateV1({
						id: this.run.id,
						taskPath,
						taskState,
						expectedRevision: revision,
					});
					this.run.tasksState[taskPath] = taskState;
					this.run.revision = newRevision;
				},
				shouldAbort: (run) => run.tasksState[taskPath]?.status === "completed",
			},
		);
	}

	private async withOptimisticRetry<T>(
		operation: {
			name: string;
			fn: (revision: number) => Promise<T>;
			shouldAbort?: (run: WorkflowRun<unknown, unknown>) => boolean;
		},
	): Promise<T | void> {
		const retryStrategy: JitteredRetryStrategy = {
			type: "jittered",
			maxAttempts: this.options.maxRetryAttempts,
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

				const { run } = await this.api.workflowRun.getByIdV1({ id: this.run.id });

				if (operation.shouldAbort && operation.shouldAbort(run)) {
					this.logger.info("Operation aborted", {
						"aiki.latestRevision": run.revision,
						"aiki.operationName": operation.name,
					});
					return;
				}

				this.run.tasksState = run.tasksState;
				this.run.state = run.state as WorkflowRunState<Output>;
				this.run.subWorkflowsRunState = run.subWorkflowsRunState;
				this.run.revision = run.revision;

				const retryParams = getRetryParams(attempt, retryStrategy);
				if (!retryParams.retriesLeft) {
					break;
				}

				this.logger.debug("Retrying operation with fresh state", {
					"aiki.latestRevision": run.revision,
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
		throw new WorkflowRunConflictError(this.run.id, operation.name, attempt);
	}
}
