import { sha256 } from "@aiki/lib/crypto";
import { delay } from "@aiki/lib/async";
import { getRetryParams } from "@aiki/lib/retry";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { SerializableInput } from "@aiki/types/serializable";
import type { TaskName } from "@aiki/types/task";
import type { WorkflowRunContext } from "@aiki/workflow";
import { isNonEmptyArray } from "@aiki/lib/array";
import { createSerializableError } from "../error.ts";
import { getChildLogger, type Logger } from "@aiki/client";
import type { TaskRunResultFailed } from "@aiki/types/task-run";
import { TaskFailedError } from "./error.ts";

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

		const existingResult = run.handle._internal.getSubTaskRunResult(path);
		if (existingResult.state === "completed") {
			return existingResult.output as Output;
		}

		const taskRunLogger = getChildLogger(run.logger, {
			"aiki.component": "task-execution",
			"aiki.taskName": this.name,
		});

		let attempts = 0;
		const retryStrategy = this.options?.retry ?? { type: "never" };

		if (existingResult.state === "failed") {
			attempts = existingResult.attempts;
			await this.delayIfNecessary(existingResult, retryStrategy, taskRunLogger);
		}

		while (true) {
			attempts++;
			const now = Date.now();

			try {
				const output = await this.params.exec(input);
				await run.handle._internal.addSubTaskRunResult(path, {
					state: "completed",
					output,
				});

				taskRunLogger.info("Task completed", { attempts });
				return output;
			} catch (error) {
				const serializableError = createSerializableError(error);
				const taskRunResult: TaskRunResultFailed = {
					state: "failed",
					reason: serializableError.message,
					attempts,
					attemptedAt: now,
					error: serializableError,
				};

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					await run.handle._internal.addSubTaskRunResult(path, taskRunResult);

					taskRunLogger.error("Task failed", {
						attempts,
						reason: taskRunResult.reason,
					});
					throw new TaskFailedError(this.name, attempts, taskRunResult.reason);
				}

				const nextAttemptAt = now + retryParams.delayMs;

				await run.handle._internal.addSubTaskRunResult(path, {
					...taskRunResult,
					nextAttemptAt,
				});

				taskRunLogger.debug("Task failed. Retrying", {
					attempts,
					nextAttemptAt,
					reason: taskRunResult.reason,
				});

				await delay(retryParams.delayMs);
			}
		}
	}

	private async delayIfNecessary(
		existingResult: TaskRunResultFailed,
		retryStrategy: RetryStrategy,
		logger: Logger,
	): Promise<void> {
		const retryParams = getRetryParams(existingResult.attempts, retryStrategy);

		if (!retryParams.retriesLeft) {
			logger.error("Task failed", {
				attempts: existingResult.attempts,
				reason: existingResult.reason,
			});
			throw new TaskFailedError(this.name, existingResult.attempts, existingResult.reason);
		}

		if (existingResult.nextAttemptAt !== undefined) {
			const now = Date.now();
			const remainingDelay = Math.max(0, existingResult.nextAttemptAt - now);
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

		const inputHash = await sha256(JSON.stringify(input));

		return this.options?.idempotencyKey
			? `${workflowRunPath}/${this.name}/${inputHash}/${this.options.idempotencyKey}`
			: `${workflowRunPath}/${this.name}/${inputHash}`;
	}
}
