import type { WorkflowName, WorkflowVersionId } from "@aiki/types/workflow";
import type {
	WorkflowOptions,
	WorkflowRunId,
	WorkflowRunStateAwaitingRetry,
	WorkflowRunStateFailed,
} from "@aiki/types/workflow-run";
import type { Client, Logger } from "@aiki/types/client";
import type { WorkflowRunContext } from "./run/context.ts";
import { initWorkflowRunStateHandle, type WorkflowRunStateHandle } from "./run/state-handle.ts";
import { isNonEmptyArray } from "@aiki/lib/array";
import { createSerializableError } from "../error.ts";
import { TaskFailedError } from "@aiki/task";
import { WorkflowRunFailedError } from "./run/error.ts";
import { getRetryParams, type RetryStrategy } from "@aiki/lib/retry";

export interface WorkflowVersionParams<Input, Output, AppContext> {
	exec: (
		input: Input,
		runContext: WorkflowRunContext<Input, Output>,
		context: AppContext,
	) => Promise<Output>;
}

export interface WorkflowVersion<Input, Output, AppContext> {
	name: WorkflowName;
	versionId: WorkflowVersionId;

	withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output, AppContext>;

	start: (
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	) => Promise<WorkflowRunStateHandle<Output>>;

	_internal: {
		exec: (
			input: Input,
			runContext: WorkflowRunContext<Input, Output>,
			context: AppContext,
		) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Input, Output, AppContext> implements WorkflowVersion<Input, Output, AppContext> {
	public readonly _internal: WorkflowVersion<Input, Output, AppContext>["_internal"];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, AppContext>,
		private readonly options?: WorkflowOptions,
	) {
		this._internal = {
			exec: this.exec.bind(this),
		};
	}

	public withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output, AppContext> {
		return new WorkflowVersionImpl(
			this.name,
			this.versionId,
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start(
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	): Promise<WorkflowRunStateHandle<Output>> {
		const response = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : null,
			options: this.options,
		});
		return initWorkflowRunStateHandle(response.run.id as WorkflowRunId, client.api);
	}

	private async exec(
		input: Input,
		runCtx: WorkflowRunContext<Input, Output>,
		context: AppContext,
	): Promise<void> {
		const { handle, logger } = runCtx;

		await handle._internal.assertExecutionAllowed();

		const retryStrategy = this.options?.retry ?? { type: "never" };
		this.assertRetryAllowed(runCtx, retryStrategy, logger);

		logger.info("Starting workflow");
		await handle.transitionState({ status: "running" });

		const output = await this.tryExecuteWorkflow(input, runCtx, context, retryStrategy);

		await handle.transitionState({ status: "completed", output });
		logger.info("Workflow complete");
	}

	private async tryExecuteWorkflow(
		input: Input,
		runCtx: WorkflowRunContext<Input, Output>,
		context: AppContext,
		retryStrategy: RetryStrategy,
	): Promise<Output> {
		while (true) {
			try {
				return await this.params.exec(input, runCtx, context);
			} catch (error) {
				const attempts = runCtx.handle.run.attempts;
				const retryParams = getRetryParams(attempts, retryStrategy);

				if (!retryParams.retriesLeft) {
					const failedState = this.createFailedState(error);
					await runCtx.handle.transitionState(failedState);

					const logMeta: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(failedState)) {
						logMeta[`aiki.${key}`] = value;
					}
					runCtx.logger.error("Workflow failed", {
						"aiki.attempts": attempts,
						...logMeta,
					});

					throw new WorkflowRunFailedError(runCtx.id, attempts, failedState.reason, failedState.cause);
				} else {
					const nextAttemptAt = Date.now() + retryParams.delayMs;
					const awaitingRetryState = this.createAwaitingRetryState(error, nextAttemptAt);
					await runCtx.handle.transitionState(awaitingRetryState);

					const logMeta: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(awaitingRetryState)) {
						logMeta[`aiki.${key}`] = value;
					}
					runCtx.logger.info("Workflow failed. Scheduled for retry", {
						"aiki.attempts": attempts,
						"aiki.nextAttemptAt": nextAttemptAt,
						"aiki.delayMs": retryParams.delayMs,
						...logMeta,
					});

					throw new WorkflowRunFailedError(
						runCtx.id,
						attempts,
						awaitingRetryState.reason,
						awaitingRetryState.cause,
					);
				}
			}
		}
	}

	private assertRetryAllowed(
		runCtx: WorkflowRunContext<Input, Output>,
		retryStrategy: RetryStrategy,
		logger: Logger,
	): void {
		const attempts = runCtx.handle.run.attempts;
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Workflow retry not allowed", {
				"aiki.attempts": attempts,
			});
			throw new WorkflowRunFailedError(runCtx.id, attempts, "Workflow retry not allowed");
		}
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskName: error.taskName,
				reason: error.reason,
			};
		}

		// TODO: check for other error types, like child workflow failures

		const serializableError = createSerializableError(error);
		return {
			status: "failed",
			cause: "self",
			reason: serializableError.message,
			error: serializableError,
		};
	}

	private createAwaitingRetryState(
		error: unknown,
		nextAttemptAt: number,
	): WorkflowRunStateAwaitingRetry {
		if (error instanceof TaskFailedError) {
			return {
				status: "awaiting_retry",
				cause: "task",
				reason: error.reason,
				nextAttemptAt: nextAttemptAt,
				taskName: error.taskName,
			};
		}

		// TODO: check for other error types, like child workflow failures

		const serializableError = createSerializableError(error);
		return {
			status: "awaiting_retry",
			cause: "self",
			reason: serializableError.message,
			nextAttemptAt: nextAttemptAt,
			error: serializableError,
		};
	}
}
