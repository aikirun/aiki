import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type WorkflowOptions,
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	type WorkflowRunStateAwaitingRetry,
	type WorkflowRunStateFailed,
	WorkflowSuspendedError,
} from "@aikirun/types/workflow-run";
import type { Client, Logger } from "@aikirun/types/client";
import type { WorkflowRunContext } from "./run/context";
import { initWorkflowRunStateHandle, type WorkflowRunStateHandle } from "./run/state-handle";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { INTERNAL } from "@aikirun/types/symbols";
import { getRetryParams, type RetryStrategy } from "@aikirun/lib/retry";
import { createSerializableError } from "@aikirun/lib/error";
import { TaskFailedError } from "@aikirun/types/task";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";

export interface WorkflowVersionParams<Input, Output, AppContext> {
	exec: (input: Input, runContext: WorkflowRunContext<Input, Output>, context: AppContext) => Promise<Output>;
	opts?: WorkflowOptions;
}

export interface WorkflowBuilder<Input, Output, AppContext> {
	opt<Path extends PathFromObject<WorkflowOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkflowOptions, Path>
	): WorkflowBuilder<Input, Output, AppContext>;
	start: WorkflowVersion<Input, Output, AppContext>["start"];
}

export interface WorkflowVersion<Input, Output, AppContext> {
	id: WorkflowId;
	versionId: WorkflowVersionId;

	with(): WorkflowBuilder<Input, Output, AppContext>;

	start: (
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	) => Promise<WorkflowRunStateHandle<Output>>;

	[INTERNAL]: {
		exec: (input: Input, runContext: WorkflowRunContext<Input, Output>, context: AppContext) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Input, Output, AppContext> implements WorkflowVersion<Input, Output, AppContext> {
	public readonly [INTERNAL]: WorkflowVersion<Input, Output, AppContext>[typeof INTERNAL];

	constructor(
		public readonly id: WorkflowId,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, AppContext>
	) {
		this[INTERNAL] = {
			exec: this.exec.bind(this),
		};
	}

	public with(): WorkflowBuilder<Input, Output, AppContext> {
		const optsOverrider = objectOverrider(this.params.opts ?? {});

		const createBuilder = (
			optsBuilder: ReturnType<typeof optsOverrider>
		): WorkflowBuilder<Input, Output, AppContext> => ({
			opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
			start: (client, ...args) =>
				new WorkflowVersionImpl(this.id, this.versionId, { ...this.params, opts: optsBuilder.build() }).start(
					client,
					...args
				),
		});

		return createBuilder(optsOverrider());
	}

	public async start(
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	): Promise<WorkflowRunStateHandle<Output>> {
		const response = await client.api.workflowRun.createV1({
			workflowId: this.id,
			workflowVersionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : null,
			options: this.params.opts,
		});
		return initWorkflowRunStateHandle(response.run.id as WorkflowRunId, client.api, client.logger);
	}

	private async exec(input: Input, runCtx: WorkflowRunContext<Input, Output>, context: AppContext): Promise<void> {
		const { handle, logger } = runCtx;

		await handle[INTERNAL].assertExecutionAllowed();

		const retryStrategy = this.params.opts?.retry ?? { type: "never" };
		this.assertRetryAllowed(runCtx.handle.run, retryStrategy, logger);

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
		retryStrategy: RetryStrategy
	): Promise<Output> {
		while (true) {
			try {
				return await this.params.exec(input, runCtx, context);
			} catch (error) {
				if (error instanceof WorkflowSuspendedError) {
					throw error;
				}

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
				}

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

				// TODO: if delay is small enough, it might be more profitable to spin
				throw new WorkflowRunFailedError(runCtx.id, attempts, awaitingRetryState.reason, awaitingRetryState.cause);
			}
		}
	}

	private assertRetryAllowed(run: WorkflowRun<Input, Output>, retryStrategy: RetryStrategy, logger: Logger): void {
		const { state } = run;
		if (state.status === "queued" && state.reason === "retry") {
			const retryParams = getRetryParams(run.attempts, retryStrategy);
			if (!retryParams.retriesLeft) {
				logger.error("Workflow retry not allowed", {
					"aiki.attempts": run.attempts,
				});
				throw new WorkflowRunFailedError(run.id as WorkflowRunId, run.attempts, "Workflow retry not allowed");
			}
		}
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskId: error.taskId,
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

	private createAwaitingRetryState(error: unknown, nextAttemptAt: number): WorkflowRunStateAwaitingRetry {
		if (error instanceof TaskFailedError) {
			return {
				status: "awaiting_retry",
				cause: "task",
				reason: error.reason,
				nextAttemptAt: nextAttemptAt,
				taskId: error.taskId,
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
