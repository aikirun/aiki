import { sha256 } from "@aiki/lib/crypto";
import { delay } from "@aiki/lib/async";
import { getRetryParams } from "@aiki/lib/retry";
import type { RetryStrategy } from "@aiki/lib/retry";
import { stableStringify } from "@aiki/lib/json";
import type { SerializableInput } from "@aiki/types/serializable";
import type { TaskName } from "@aiki/types/task";
import {
	WorkflowRunCancelledError,
	type WorkflowRunContext,
	WorkflowRunNotExecutableError,
	WorkflowRunPausedError,
} from "@aiki/workflow";
import { isNonEmptyArray } from "@aiki/lib/array";
import { createSerializableError } from "../error.ts";
import { getChildLogger, type Logger } from "@aiki/client";
import type { TaskStateFailed } from "@aiki/types/task";
import { TaskFailedError } from "./error.ts";
import type { WorkflowRunId } from "@aiki/types/workflow-run";

export function task<
	Input extends SerializableInput = null,
	Output = void,
>(params: TaskParams<Input, Output>): Task<Input, Output> {
	return new TaskImpl(params);
}

export interface TaskParams<Input, Output> {
	name: string;
	exec: (input: Input) => Promise<Output>;
}

export interface TaskOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
}

export interface Task<Input, Output> {
	name: TaskName;

	withOptions(options: TaskOptions): Task<Input, Output>;

	start: <WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		...args: Input extends null ? [] : [Input]
	) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly name: TaskName;

	constructor(
		private readonly params: TaskParams<Input, Output>,
		private readonly options?: TaskOptions,
	) {
		this.name = params.name as TaskName;
	}

	public withOptions(options: TaskOptions): Task<Input, Output> {
		return new TaskImpl(
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		...args: Input extends null ? [] : [Input]
	): Promise<Output> {
		// this cast is okay cos if args is empty, Input must be type null
		const input = isNonEmptyArray(args) ? args[0] : null as Input;
		const path = await this.getPath(run, input);

		const currentState = run.handle._internal.getTaskState(path);
		if (currentState.status === "completed") {
			return currentState.output as Output;
		}

		const logger = getChildLogger(run.logger, {
			"aiki.component": "task-execution",
			"aiki.taskName": this.name,
			"aiki.taskPath": path,
		});

		let attempts = 0;
		const retryStrategy = this.options?.retry ?? { type: "never" };

		if (currentState.status === "running") {
			logger.warn("Task crashed during last attempt. Retrying task.", {
				"aiki.attemptToRetry": currentState.attempts,
			});
			attempts = currentState.attempts;
		} else if (currentState.status === "failed") {
			this.assertRetryAllowed(currentState, retryStrategy, logger);
			logger.info("Task failed last attempt. Retrying.", {
				"aiki.attempts": currentState.attempts,
			});
			attempts = currentState.attempts;
			await this.delayIfNecessary(currentState);
		}

		while (true) {
			this.assertExecutionAllowed(run);

			attempts++;
			const now = Date.now();

			await run.handle._internal.transitionTaskState(path, { status: "running", attempts });

			try {
				const output = await this.params.exec(input);
				await run.handle._internal.transitionTaskState(path, { status: "completed", output });

				logger.info("Task completed", { "aiki.attempts": attempts });
				return output;
			} catch (error) {
				if (error instanceof WorkflowRunNotExecutableError) {
					throw error;
				}

				const serializableError = createSerializableError(error);
				const taskFailedState: TaskStateFailed = {
					status: "failed",
					reason: serializableError.message,
					attempts,
					attemptedAt: now,
					error: serializableError,
				};

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					await run.handle._internal.transitionTaskState(path, taskFailedState);

					logger.error("Task failed", {
						"aiki.attempts": attempts,
						"aiki.reason": taskFailedState.reason,
					});
					throw new TaskFailedError(this.name, attempts, taskFailedState.reason);
				}

				const nextAttemptAt = now + retryParams.delayMs;

				await run.handle._internal.transitionTaskState(path, { ...taskFailedState, nextAttemptAt });

				logger.debug("Task failed. Retrying", {
					attempts,
					nextAttemptAt,
					reason: taskFailedState.reason,
				});

				await delay(retryParams.delayMs);
			}
		}
	}

	private assertRetryAllowed(
		taskState: TaskStateFailed,
		retryStrategy: RetryStrategy,
		logger: Logger,
	): void {
		const retryParams = getRetryParams(taskState.attempts, retryStrategy);

		if (!retryParams.retriesLeft) {
			logger.error("Task failed", {
				"aiki.attempts": taskState.attempts,
				"aiki.reason": taskState.reason,
			});
			throw new TaskFailedError(this.name, taskState.attempts, taskState.reason);
		}
	}

	private assertExecutionAllowed<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
	): void {
		const workflowStatus = run.handle.run.state.status;
		if (workflowStatus === "running") {
			return;
		}
		if (workflowStatus === "cancelled") {
			throw new WorkflowRunCancelledError(run.id as WorkflowRunId);
		}
		if (workflowStatus === "paused") {
			throw new WorkflowRunPausedError(run.id as WorkflowRunId);
		}
		throw new WorkflowRunNotExecutableError(run.id as WorkflowRunId, workflowStatus);
	}

	private async delayIfNecessary(taskState: TaskStateFailed): Promise<void> {
		if (taskState.nextAttemptAt !== undefined) {
			const now = Date.now();
			const remainingDelay = Math.max(0, taskState.nextAttemptAt - now);
			if (remainingDelay > 0) {
				await delay(remainingDelay);
			}
		}
	}

	private async getPath<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		input: Input,
	): Promise<string> {
		const workflowRunPath = `${run.name}/${run.versionId}/${run.id}`;

		const inputHash = await sha256(stableStringify(input));

		return this.options?.idempotencyKey
			? `${workflowRunPath}/${this.name}/${inputHash}/${this.options.idempotencyKey}`
			: `${workflowRunPath}/${this.name}/${inputHash}`;
	}
}
