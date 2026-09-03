import { delay } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import { getCompositeId } from "@aikirun/lib/id";
import type { Logger } from "@aikirun/lib/logger";
import {
	type ObjectBuilder,
	objectOverrider,
	type PathFromObject,
	type RequireAtLeastOneProp,
	type TypeOfValueAtPath,
} from "@aikirun/lib/object";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { getRetryParams } from "@aikirun/lib/retry";
import type { Serializable } from "@aikirun/lib/serializable";
import { createSerializableError } from "@aikirun/lib/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import type { UnconsumedManifestEntries, WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	NonDeterminismError,
	WorkflowRunFailedError,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import type {
	TaskAddress,
	TaskId,
	TaskInfo,
	TaskName,
	TaskStartOptions,
	TaskStateAwaitingRetry,
} from "@aikirun/types/workflow/task";
import { TaskFailedError } from "@aikirun/types/workflow/task";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRun } from "./run";
import type { WorkflowExecutionConfig } from "./run/execute";
import type { WorkflowRunHandle } from "./run/handle";
import { validateWithSchema } from "./run/schema-validation";
import type { TaskExecutionTracker } from "./run/task-execution-tracker";

type UnknownWorkflowRun = WorkflowRun<unknown>;
type UnknownWorkflowRunHandle = WorkflowRunHandle<unknown, unknown>;

/**
 * Defines a durable task with deterministic execution and automatic retries.
 *
 * Tasks must be deterministic - the same input should always produce the same output.
 * Tasks can be retried multiple times, so they should be idempotent when possible.
 * Tasks execute within a workflow context and can access logging.
 *
 * @template Input - Type of task input (must be JSON serializable)
 * @template Output - Type of task output (must be JSON serializable)
 * @param params - Task configuration
 * @param params.name - Unique task name used for execution tracking
 * @param params.handler - Async function that executes the task logic
 * @returns Task instance with retry and option configuration methods
 *
 * @example
 * ```typescript
 * // Simple task without retry
 * export const sendEmail = task({
 *   name: "send-email",
 *   handler(input: { email: string; message: string }) {
 *     return emailService.send(input.email, input.message);
 *   },
 * });
 *
 * // Task with retry configuration
 * export const chargeCard = task({
 *   name: "charge-card",
 *   handler(input: { cardId: string; amount: number }) {
 *     return paymentService.charge(input.cardId, input.amount);
 *   },
 *   retry: {
 *     type: "fixed",
 *     maxAttempts: 3,
 *     delayMs: 1_000,
 *   },
 * });
 *
 * // Execute task in workflow
 * const result = await chargeCard.start(run, { cardId: "123", amount: 9999 });
 * ```
 */
export function task<Input = void, Output = void>(
	params: TaskParams<Input, Output> & Serializable<Input, "input"> & Serializable<Output, "output">
): Task<Input, Output> {
	return new TaskImpl(params);
}

export interface TaskParams<Input, Output> {
	name: string;
	handler: (input: Input) => Promise<Output>;
	retry?: RetryStrategy;
	schema?: RequireAtLeastOneProp<{
		input?: StandardSchemaV1<Input>;
		output?: StandardSchemaV1<Output>;
	}>;
}

export interface Task<Input, Output> {
	name: TaskName;
	/** Sets one start option and returns a copy of {@link Task}. The original is unchanged. */
	with<Path extends PathFromObject<TaskStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskStartOptions, Path>
	): Task<Input, Output>;
	start: (run: UnknownWorkflowRun, ...args: Input extends void ? [] : [Input]) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly name: TaskName;
	private readonly startOptionsBuilder: ObjectBuilder<TaskStartOptions>;

	constructor(
		private readonly params: TaskParams<Input, Output>,
		startOptionsBuilder?: ObjectBuilder<TaskStartOptions>
	) {
		this.name = params.name as TaskName;
		this.startOptionsBuilder = startOptionsBuilder ?? objectOverrider<TaskStartOptions>({ retry: this.params.retry })();
	}

	public with<Path extends PathFromObject<TaskStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskStartOptions, Path>
	): Task<Input, Output> {
		return new TaskImpl(this.params, this.startOptionsBuilder.with(path, value));
	}

	public async start(run: UnknownWorkflowRun, ...args: Input extends void ? [] : [Input]): Promise<Output> {
		const executionTracker = run[INTERNAL].createTaskExecutionTracker();
		try {
			return await this.startWithOptions(run, this.startOptionsBuilder.build(), executionTracker, ...args);
		} finally {
			executionTracker.end();
		}
	}

	private async startWithOptions(
		run: UnknownWorkflowRun,
		startOptions: TaskStartOptions,
		executionTracker: TaskExecutionTracker,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		const {
			logger,
			[INTERNAL]: { handle, hasher, replayManifest, configProvider },
		} = run;

		handle[INTERNAL].assertExecutionAllowed();

		const inputRaw = args[0];
		const inputSchema = this.params.schema?.input;
		const inputSchemaValidationResult = inputSchema
			? validateWithSchema(handle, inputSchema, inputRaw, logger, "Invalid task data")
			: (inputRaw as Input);
		const input =
			inputSchemaValidationResult instanceof Promise ? await inputSchemaValidationResult : inputSchemaValidationResult;
		const inputHash = await hasher(input);
		const address = getCompositeId<TaskAddress>({ name: this.name, referenceId: inputHash });

		if (replayManifest.hasUnconsumedEntries()) {
			const existingTaskInfo = replayManifest.consumeNextTask(address);
			if (existingTaskInfo) {
				return this.getExistingTaskResult(handle, executionTracker, input, existingTaskInfo, configProvider, logger);
			}

			await this.throwNonDeterminismError(handle, inputHash, replayManifest.getUnconsumedEntries(), logger);
		}

		const attempts = 1;
		const retryStrategy = startOptions.retry ?? { type: "never" };

		const taskInfo = await handle[INTERNAL].transitionTaskState({
			type: "create",
			taskName: this.name,
			options: startOptions,
			input: await handle[INTERNAL].codec.encode(input),
			inputHash,
		});

		const taskLogger = logger.child({
			"aiki.taskName": this.name,
			"aiki.taskId": taskInfo.id,
		});

		taskLogger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(
			handle,
			executionTracker,
			input,
			taskInfo.id as TaskId,
			retryStrategy,
			attempts,
			configProvider,
			taskLogger
		);

		await handle[INTERNAL].transitionTaskState({
			id: taskInfo.id,
			attempts: lastAttempt,
			state: { status: "completed", output: await handle[INTERNAL].codec.encode(output) },
		});
		taskLogger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async getExistingTaskResult(
		handle: UnknownWorkflowRunHandle,
		executionTracker: TaskExecutionTracker,
		input: Input,
		existingTaskInfo: TaskInfo,
		configProvider: ConfigProvider<WorkflowExecutionConfig>,
		logger: Logger
	) {
		const existingTaskState = existingTaskInfo.state;

		if (existingTaskState.status === "completed") {
			return (await handle[INTERNAL].codec.decode(existingTaskState.output)) as Output;
		}

		if (existingTaskState.status === "failed") {
			throw new TaskFailedError(
				existingTaskInfo.id as TaskId,
				existingTaskInfo.attempts,
				existingTaskState.error.message
			);
		}

		existingTaskState.status satisfies "running" | "awaiting_retry";

		const attempts = existingTaskInfo.attempts;
		const retryStrategy = existingTaskInfo.options?.retry ?? { type: "never" };
		this.assertRetryAttemptsLeft(existingTaskInfo.id as TaskId, attempts, retryStrategy, logger);
		if (existingTaskState.status === "awaiting_retry") {
			await this.assertRetryIsDue(
				handle,
				executionTracker,
				existingTaskInfo.id as TaskId,
				existingTaskState,
				configProvider,
				logger
			);
		}

		logger.debug("Retrying task", {
			"aiki.taskName": this.name,
			"aiki.taskId": existingTaskInfo.id,
			"aiki.attempts": attempts,
			"aiki.taskStatus": existingTaskState.status,
		});

		return this.retryExecute(
			handle,
			executionTracker,
			input,
			existingTaskInfo.id,
			retryStrategy,
			attempts,
			configProvider,
			logger
		);
	}

	private async retryExecute(
		handle: UnknownWorkflowRunHandle,
		executionTracker: TaskExecutionTracker,
		input: Input,
		taskId: string,
		retryStrategy: RetryStrategy,
		previousAttempts: number,
		configProvider: ConfigProvider<WorkflowExecutionConfig>,
		logger: Logger
	): Promise<Output> {
		const attempts = previousAttempts + 1;

		const taskInfo = await handle[INTERNAL].transitionTaskState({
			type: "retry",
			id: taskId,
			attempts,
		});

		const taskLogger = logger.child({
			"aiki.taskName": this.name,
			"aiki.taskId": taskInfo.id,
		});
		taskLogger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(
			handle,
			executionTracker,
			input,
			taskInfo.id as TaskId,
			retryStrategy,
			attempts,
			configProvider,
			taskLogger
		);

		await handle[INTERNAL].transitionTaskState({
			id: taskInfo.id,
			attempts: lastAttempt,
			state: { status: "completed", output: await handle[INTERNAL].codec.encode(output) },
		});
		taskLogger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask(
		handle: UnknownWorkflowRunHandle,
		executionTracker: TaskExecutionTracker,
		input: Input,
		taskId: TaskId,
		retryStrategy: RetryStrategy,
		currentAttempt: number,
		configProvider: ConfigProvider<WorkflowExecutionConfig>,
		logger: Logger
	): Promise<{ output: Output; lastAttempt: number }> {
		let attempts = currentAttempt;

		// TODO: Add test cases for this:
		// Infra changes like transitioning of task state should not consume retry budget.
		// Even if task crashes while trying to transition state, it will be picked up
		// by another worker, who will either fail the task if retry budget is
		// exhausted or retry the task

		while (true) {
			try {
				const outputRaw = await this.params.handler(input);
				const outputSchema = this.params.schema?.output;
				const outputSchemaValidationResult = outputSchema
					? validateWithSchema(handle, outputSchema, outputRaw, logger, "Invalid task data")
					: (outputRaw as Output);
				const output =
					outputSchemaValidationResult instanceof Promise
						? await outputSchemaValidationResult
						: outputSchemaValidationResult;
				return {
					output: output !== undefined ? JSON.parse(JSON.stringify(output)) : output,
					lastAttempt: attempts,
				};
			} catch (err) {
				if (
					err instanceof WorkflowRunSuspendedError ||
					err instanceof WorkflowRunFailedError ||
					err instanceof WorkflowRunRevisionConflictError
				) {
					throw err;
				}

				const serializableError = createSerializableError(err);

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					logger.error("Task failed", {
						"aiki.attempts": attempts,
						"aiki.reason": serializableError.message,
					});
					await handle[INTERNAL].transitionTaskState({
						id: taskId,
						attempts,
						state: { status: "failed", error: serializableError },
					});
					throw new TaskFailedError(taskId, attempts, serializableError.message);
				}

				logger.debug("Task failed. It will be retried", {
					"aiki.attempts": attempts,
					"aiki.nextAttemptInMs": retryParams.delayMs,
					"aiki.reason": serializableError.message,
				});

				if (retryParams.delayMs <= configProvider.config.maxInlineWaitMs) {
					await delay(retryParams.delayMs);
					attempts++;
					continue;
				}

				await handle[INTERNAL].transitionTaskState({
					id: taskId,
					attempts,
					state: {
						status: "awaiting_retry",
						error: serializableError,
						nextAttemptInMs: retryParams.delayMs,
					},
				});
				executionTracker.awaitingRetry();
				throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
			}
		}
	}

	private async throwNonDeterminismError(
		handle: UnknownWorkflowRunHandle,
		inputHash: string,
		unconsumedManifestEntries: UnconsumedManifestEntries,
		logger: Logger
	): Promise<never> {
		logger.error("Replay divergence", {
			"aiki.taskName": this.name,
			"aiki.inputHash": inputHash,
			"aiki.unconsumedManifestEntries": unconsumedManifestEntries,
		});
		const err = new NonDeterminismError(handle.run.id as WorkflowRunId, handle.run.attempts, unconsumedManifestEntries);
		await handle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: createSerializableError(err),
		});
		throw err;
	}

	private assertRetryAttemptsLeft(
		taskId: TaskId,
		attempts: number,
		retryStrategy: RetryStrategy,
		logger: Logger
	): void {
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Task retry not allowed", {
				"aiki.taskName": this.name,
				"aiki.taskId": taskId,
				"aiki.attempts": attempts,
			});
			throw new TaskFailedError(taskId, attempts, "Task retry not allowed");
		}
	}

	private async assertRetryIsDue(
		handle: UnknownWorkflowRunHandle,
		executionTracker: TaskExecutionTracker,
		taskId: TaskId,
		taskState: TaskStateAwaitingRetry,
		configProvider: ConfigProvider<WorkflowExecutionConfig>,
		logger: Logger
	): Promise<void> {
		const remainingDelayMs = taskState.nextAttemptAt - Date.now();
		if (remainingDelayMs > configProvider.config.maxInlineWaitMs) {
			executionTracker.awaitingRetry();
			logger.debug("Task retry not due, suspending", {
				"aiki.taskName": this.name,
				"aiki.taskId": taskId,
				"aiki.remainingDelayMs": remainingDelayMs,
			});
			throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
		}
		if (remainingDelayMs > 0) {
			await delay(remainingDelayMs);
		}
	}
}
