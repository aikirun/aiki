import { isNonEmptyArray } from "@aikirun/lib/array";
import { createSerializableError } from "@aikirun/lib/error";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import { getRetryParams, type RetryStrategy } from "@aikirun/lib/retry";
import type { Client, Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import { TaskFailedError } from "@aikirun/types/task";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type WorkflowOptions,
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	type WorkflowRunStateFailed,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunStateAwaitingRetryRequest } from "@aikirun/types/workflow-run-api";

import type { WorkflowRunContext } from "./run/context";
import { type WorkflowRunHandle, workflowRunHandle } from "./run/handle";

export interface WorkflowVersionParams<Input, Output, AppContext> {
	handler: (input: Input, run: Readonly<WorkflowRunContext<Input, Output>>, context: AppContext) => Promise<Output>;
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
	) => Promise<WorkflowRunHandle<Input, Output>>;

	[INTERNAL]: {
		handler: (input: Input, run: WorkflowRunContext<Input, Output>, context: AppContext) => Promise<void>;
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
			handler: this.handler.bind(this),
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
	): Promise<WorkflowRunHandle<Input, Output>> {
		const { run } = await client.api.workflowRun.createV1({
			workflowId: this.id,
			workflowVersionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : null,
			options: this.params.opts,
		});
		return workflowRunHandle(client, run as WorkflowRun<Input, Output>);
	}

	private async handler(input: Input, run: WorkflowRunContext<Input, Output>, context: AppContext): Promise<void> {
		const { logger } = run;
		const { handle } = run[INTERNAL];

		handle[INTERNAL].assertExecutionAllowed();

		const retryStrategy = this.params.opts?.retry ?? { type: "never" };
		const state = handle.run.state;
		if (state.status === "queued" && state.reason === "retry") {
			this.assertRetryAllowed(handle.run.id as WorkflowRunId, handle.run.attempts, retryStrategy, logger);
		}

		logger.info("Starting workflow");
		await handle[INTERNAL].transitionState({ status: "running" });

		const output = await this.tryExecuteWorkflow(input, run, context, retryStrategy);

		await handle[INTERNAL].transitionState({ status: "completed", output });
		logger.info("Workflow complete");
	}

	private async tryExecuteWorkflow(
		input: Input,
		run: WorkflowRunContext<Input, Output>,
		context: AppContext,
		retryStrategy: RetryStrategy
	): Promise<Output> {
		while (true) {
			try {
				return await this.params.handler(input, run, context);
			} catch (error) {
				if (error instanceof WorkflowRunSuspendedError) {
					throw error;
				}

				const attempts = run[INTERNAL].handle.run.attempts;
				const retryParams = getRetryParams(attempts, retryStrategy);

				if (!retryParams.retriesLeft) {
					const failedState = this.createFailedState(error);
					await run[INTERNAL].handle[INTERNAL].transitionState(failedState);

					const logMeta: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(failedState)) {
						logMeta[`aiki.${key}`] = value;
					}
					run.logger.error("Workflow failed", {
						"aiki.attempts": attempts,
						...logMeta,
					});
					throw new WorkflowRunFailedError(run.id, attempts);
				}

				const awaitingRetryState = this.createAwaitingRetryState(error, retryParams.delayMs);
				await run[INTERNAL].handle[INTERNAL].transitionState(awaitingRetryState);

				const logMeta: Record<string, unknown> = {};
				for (const [key, value] of Object.entries(awaitingRetryState)) {
					logMeta[`aiki.${key}`] = value;
				}
				run.logger.info("Workflow failed. Awaiting retry", {
					"aiki.attempts": attempts,
					"aiki.delayMs": retryParams.delayMs,
					...logMeta,
				});

				// TODO: if delay is small enough, it might be more profitable to spin
				// Spinning should not reload workflow state or transition to awaiting retry
				// If the workflow failed
				throw new WorkflowRunSuspendedError(run.id);
			}
		}
	}

	private assertRetryAllowed(id: WorkflowRunId, attempts: number, retryStrategy: RetryStrategy, logger: Logger): void {
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Workflow retry not allowed", {
				"aiki.attempts": attempts,
			});
			throw new WorkflowRunFailedError(id, attempts);
		}
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskPath: error.taskPath,
			};
		}

		// TODO: check for other error types, like child workflow failures

		const serializableError = createSerializableError(error);
		return {
			status: "failed",
			cause: "self",
			error: serializableError,
		};
	}

	private createAwaitingRetryState(error: unknown, nextAttemptInMs: number): WorkflowRunStateAwaitingRetryRequest {
		if (error instanceof TaskFailedError) {
			return {
				status: "awaiting_retry",
				cause: "task",
				nextAttemptInMs,
				taskPath: error.taskPath,
			};
		}

		// TODO: check for other error types, like child workflow failures

		const serializableError = createSerializableError(error);
		return {
			status: "awaiting_retry",
			cause: "self",
			nextAttemptInMs,
			error: serializableError,
		};
	}
}
