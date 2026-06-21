import { getTaskAddress } from "@aikirun/lib/address";
import { delay } from "@aikirun/lib/async";
import type { ConfigProvider } from "@aikirun/lib/config";
import { hashInput } from "@aikirun/lib/crypto";
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
import type { TaskAddress, TaskId, TaskInfo, TaskName, TaskStartOptions } from "@aikirun/types/workflow/task";
import { TaskFailedError } from "@aikirun/types/workflow/task";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { WorkflowRun } from "./run";
import type { WorkflowExecutionConfig } from "./run/execute";
import type { WorkflowRunHandle } from "./run/handle";

type UnknownWorkflowRun = WorkflowRun<unknown, unknown>;
type UnknownWorkflowRunHandle = WorkflowRunHandle<unknown, unknown, unknown>;

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
export function task<Input extends Serializable = void, Output extends Serializable = void>(
	params: TaskParams<Input, Output>
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
	with(): TaskBuilder<Input, Output>;
	start: (run: UnknownWorkflowRun, ...args: Input extends void ? [] : [Input]) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly name: TaskName;

	constructor(private readonly params: TaskParams<Input, Output>) {
		this.name = params.name as TaskName;
	}

	private definitionStartOptions(): TaskStartOptions {
		return this.params.retry === undefined ? {} : { retry: this.params.retry };
	}

	public with(): TaskBuilder<Input, Output> {
		const startOptionsOverrider = objectOverrider(this.definitionStartOptions());
		return createTaskBuilder(this, startOptionsOverrider());
	}

	public async start(run: UnknownWorkflowRun, ...args: Input extends void ? [] : [Input]): Promise<Output> {
		return this.startWithOptions(run, this.definitionStartOptions(), ...args);
	}

	public async startWithOptions(
		run: UnknownWorkflowRun,
		startOptions: TaskStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		const handle = run[INTERNAL].handle;
		handle[INTERNAL].assertExecutionAllowed();

		const inputRaw = args[0];
		const inputSchema = this.params.schema?.input;
		const input = inputSchema ? await this.parse(handle, inputSchema, inputRaw, run.logger) : (inputRaw as Input);
		const inputHash = await hashInput(input);
		const address = getTaskAddress(this.name, inputHash) as TaskAddress;

		const replayManifest = run[INTERNAL].replayManifest;

		if (replayManifest.hasUnconsumedEntries()) {
			const existingTaskInfo = replayManifest.consumeNextTask(address);
			if (existingTaskInfo) {
				return this.getExistingTaskResult(run, handle, startOptions, input, existingTaskInfo);
			}

			await this.throwNonDeterminismError(run, handle, inputHash, replayManifest.getUnconsumedEntries());
		}

		const attempts = 1;
		const retryStrategy = startOptions.retry ?? { type: "never" };

		const taskInfo = await handle[INTERNAL].transitionTaskState({
			type: "create",
			taskName: this.name,
			options: startOptions,
			taskState: { status: "running", attempts, input },
		});

		const logger = run.logger.child({
			"aiki.taskName": this.name,
			"aiki.taskId": taskInfo.id,
		});

		logger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(
			handle,
			input,
			taskInfo.id as TaskId,
			retryStrategy,
			attempts,
			run[INTERNAL].configProvider,
			logger
		);

		await handle[INTERNAL].transitionTaskState({
			taskId: taskInfo.id,
			taskState: { status: "completed", attempts: lastAttempt, output },
		});
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async getExistingTaskResult(
		run: UnknownWorkflowRun,
		handle: UnknownWorkflowRunHandle,
		startOptions: TaskStartOptions,
		input: Input,
		existingTaskInfo: TaskInfo
	) {
		const existingTaskState = existingTaskInfo.state;

		if (existingTaskState.status === "completed") {
			const outputSchema = this.params.schema?.output;
			return outputSchema
				? this.parse(handle, outputSchema, existingTaskState.output, run.logger)
				: (existingTaskState.output as Output);
		}

		if (existingTaskState.status === "failed") {
			throw new TaskFailedError(
				existingTaskInfo.id as TaskId,
				existingTaskState.attempts,
				existingTaskState.error.message
			);
		}

		existingTaskState.status satisfies "running" | "awaiting_retry";

		const attempts = existingTaskState.attempts;
		const retryStrategy = startOptions.retry ?? { type: "never" };
		this.assertRetryAllowed(existingTaskInfo.id as TaskId, attempts, retryStrategy, run.logger);

		run.logger.debug("Retrying task", {
			"aiki.taskName": this.name,
			"aiki.taskId": existingTaskInfo.id,
			"aiki.attempts": attempts,
			"aiki.taskStatus": existingTaskState.status,
		});

		return this.retryAndExecute(run, handle, input, existingTaskInfo.id, startOptions, retryStrategy, attempts);
	}

	private async throwNonDeterminismError(
		run: UnknownWorkflowRun,
		handle: UnknownWorkflowRunHandle,
		inputHash: string,
		unconsumedManifestEntries: UnconsumedManifestEntries
	) {
		run.logger.error("Replay divergence", {
			"aiki.taskName": this.name,
			"aiki.inputHash": inputHash,
			"aiki.unconsumedManifestEntries": unconsumedManifestEntries,
		});
		const error = new NonDeterminismError(run.id, handle.run.attempts, unconsumedManifestEntries);
		await handle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: createSerializableError(error),
		});
		throw error;
	}

	private async retryAndExecute(
		run: UnknownWorkflowRun,
		handle: UnknownWorkflowRunHandle,
		input: Input,
		taskId: string,
		startOptions: TaskStartOptions,
		retryStrategy: RetryStrategy,
		previousAttempts: number
	): Promise<Output> {
		const attempts = previousAttempts + 1;

		const taskInfo = await handle[INTERNAL].transitionTaskState({
			type: "retry",
			taskId,
			options: startOptions,
			taskState: { status: "running", attempts, input },
		});

		const logger = run.logger.child({
			"aiki.taskName": this.name,
			"aiki.taskId": taskInfo.id,
		});
		logger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(
			handle,
			input,
			taskInfo.id as TaskId,
			retryStrategy,
			attempts,
			run[INTERNAL].configProvider,
			logger
		);

		await handle[INTERNAL].transitionTaskState({
			taskId: taskInfo.id,
			taskState: { status: "completed", attempts: lastAttempt, output },
		});
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask(
		handle: UnknownWorkflowRunHandle,
		input: Input,
		taskId: TaskId,
		retryStrategy: RetryStrategy,
		currentAttempt: number,
		configProvider: ConfigProvider<Required<WorkflowExecutionConfig>>,
		logger: Logger
	): Promise<{ output: Output; lastAttempt: number }> {
		let attempts = currentAttempt;

		// TODO: Add test cases for this:
		// Infra changes like transitioning of task state should not consume retry budget.
		// Even if task crashes while trying to transition state, it will be picked up
		// by another worker, who will either fail the task if retry budget is
		// exhaused or retry the task

		while (true) {
			try {
				const outputRaw = await this.params.handler(input);
				const outputSchema = this.params.schema?.output;
				const output = outputSchema ? await this.parse(handle, outputSchema, outputRaw, logger) : (outputRaw as Output);
				return { output, lastAttempt: attempts };
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
						taskId,
						taskState: { status: "failed", attempts, error: serializableError },
					});
					throw new TaskFailedError(taskId, attempts, serializableError.message);
				}

				logger.debug("Task failed. It will be retried", {
					"aiki.attempts": attempts,
					"aiki.nextAttemptInMs": retryParams.delayMs,
					"aiki.reason": serializableError.message,
				});

				if (retryParams.delayMs <= configProvider.config.spinThresholdMs) {
					await delay(retryParams.delayMs);
					attempts++;
					continue;
				}

				await handle[INTERNAL].transitionTaskState({
					taskId,
					taskState: {
						status: "awaiting_retry",
						attempts,
						error: serializableError,
						nextAttemptInMs: retryParams.delayMs,
					},
				});
				throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
			}
		}
	}

	private assertRetryAllowed(taskId: TaskId, attempts: number, retryStrategy: RetryStrategy, logger: Logger): void {
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

	private async parse<T>(
		handle: UnknownWorkflowRunHandle,
		schema: StandardSchemaV1<T>,
		data: unknown,
		logger: Logger
	): Promise<T> {
		const schemaValidation = schema["~standard"].validate(data);
		const schemaValidationResult = schemaValidation instanceof Promise ? await schemaValidation : schemaValidation;
		if (!schemaValidationResult.issues) {
			return schemaValidationResult.value;
		}

		logger.error("Invalid task data", { "aiki.issues": schemaValidationResult.issues });
		await handle[INTERNAL].transitionState({
			status: "failed",
			cause: "self",
			error: {
				name: "SchemaValidationError",
				message: JSON.stringify(schemaValidationResult.issues),
			},
		});
		throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
	}
}

export interface TaskBuilder<Input, Output> {
	opt<Path extends PathFromObject<TaskStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskStartOptions, Path>
	): TaskBuilder<Input, Output>;
	start: Task<Input, Output>["start"];
}

function createTaskBuilder<Input, Output>(
	task: TaskImpl<Input, Output>,
	startOptionsBuilder: ObjectBuilder<TaskStartOptions>
): TaskBuilder<Input, Output> {
	return {
		opt(path, value) {
			return createTaskBuilder(task, startOptionsBuilder.with(path, value));
		},

		start(run, ...args) {
			return task.startWithOptions(run, startOptionsBuilder.build(), ...args);
		},
	};
}
