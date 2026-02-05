import { getTaskAddress } from "@aikirun/lib/address";
import { delay } from "@aikirun/lib/async";
import { hashInput } from "@aikirun/lib/crypto";
import { createSerializableError } from "@aikirun/lib/error";
import {
	type ObjectBuilder,
	objectOverrider,
	type PathFromObject,
	type RequireAtLeastOneProp,
	type TypeOfValueAtPath,
} from "@aikirun/lib/object";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { getRetryParams } from "@aikirun/lib/retry";
import type { Logger } from "@aikirun/types/client";
import type { Serializable } from "@aikirun/types/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import type {
	TaskAddress,
	TaskDefinitionOptions,
	TaskId,
	TaskInfo,
	TaskReferenceOptions,
	TaskStartOptions,
} from "@aikirun/types/task";
import { TaskConflictError, TaskFailedError, type TaskName } from "@aikirun/types/task";
import {
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunRevisionConflictError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";
import type { WorkflowRunContext, WorkflowRunHandle } from "@aikirun/workflow";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { EventsDefinition } from "sdk/workflow/run/event";

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
 *   opts: {
 *     retry: {
 *       type: "fixed",
 *       maxAttempts: 3,
 *       delayMs: 1000,
 *     },
 *   },
 * });
 *
 * // Execute task in workflow
 * const result = await chargeCard.start(run, { cardId: "123", amount: 9999 });
 * ```
 */
export function task<Input extends Serializable, Output extends Serializable>(
	params: TaskParams<Input, Output>
): Task<Input, Output> {
	return new TaskImpl(params);
}

export interface TaskParams<Input, Output> {
	name: string;
	handler: (input: Input) => Promise<Output>;
	opts?: TaskDefinitionOptions;
	schema?: RequireAtLeastOneProp<{
		input?: StandardSchemaV1<Input>;
		output?: StandardSchemaV1<Output>;
	}>;
}

export interface Task<Input, Output> {
	name: TaskName;
	with(): TaskBuilder<Input, Output>;
	start: (
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly name: TaskName;

	constructor(private readonly params: TaskParams<Input, Output>) {
		this.name = params.name as TaskName;
	}

	public with(): TaskBuilder<Input, Output> {
		const startOpts: TaskStartOptions = this.params.opts ?? {};
		const startOptsOverrider = objectOverrider(startOpts);
		return new TaskBuilderImpl(this, startOptsOverrider());
	}

	public async start(
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		return this.startWithOpts(run, this.params.opts ?? {}, ...args);
	}

	public async startWithOpts(
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		startOpts: TaskStartOptions,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		const handle = run[INTERNAL].handle;
		handle[INTERNAL].assertExecutionAllowed();

		const inputRaw = args[0];
		const input = await this.parse(handle, this.params.schema?.input, inputRaw, run.logger);
		const inputHash = await hashInput(input);

		const reference = startOpts.reference;
		const address = getTaskAddress(this.name, reference?.id ?? inputHash);
		const existingTaskInfo = handle.run.tasks[address];
		if (existingTaskInfo) {
			await this.assertUniqueTaskReferenceId(handle, existingTaskInfo, inputHash, reference, run.logger);
		}

		if (existingTaskInfo?.state.status === "completed") {
			return this.parse(handle, this.params.schema?.output, existingTaskInfo.state.output, run.logger);
		}
		if (existingTaskInfo?.state.status === "failed") {
			const { state } = existingTaskInfo;
			throw new TaskFailedError(existingTaskInfo.id as TaskId, state.attempts, state.error.message);
		}

		let attempts = 0;
		const retryStrategy = startOpts.retry ?? { type: "never" };

		if (existingTaskInfo?.state) {
			const taskId = existingTaskInfo.id as TaskId;
			const state = existingTaskInfo?.state;

			attempts = state.attempts;

			this.assertRetryAllowed(taskId, attempts, retryStrategy, run.logger);

			run.logger.debug("Retrying task", {
				"aiki.taskName": this.name,
				"aiki.taskId": taskId,
				"aiki.attempts": attempts,
				"aiki.taskStatus": state.status,
			});
		}

		attempts++;

		const { id: taskId } = existingTaskInfo
			? await handle[INTERNAL].transitionTaskState(address, {
					type: "retry",
					taskId: existingTaskInfo.id,
					options: startOpts,
					taskState: { status: "running", attempts, input },
				})
			: await handle[INTERNAL].transitionTaskState(address, {
					type: "create",
					taskName: this.name,
					options: startOpts,
					taskState: { status: "running", attempts, input },
				});

		const logger = run.logger.child({
			"aiki.component": "task-execution",
			"aiki.taskName": this.name,
			"aiki.taskId": taskId,
		});
		logger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(
			handle,
			input,
			address,
			taskId as TaskId,
			retryStrategy,
			attempts,
			run[INTERNAL].options.spinThresholdMs,
			logger
		);

		await handle[INTERNAL].transitionTaskState(address, {
			taskId,
			taskState: { status: "completed", attempts: lastAttempt, output },
		});
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask(
		handle: WorkflowRunHandle<unknown, unknown, unknown, EventsDefinition>,
		input: Input,
		address: TaskAddress,
		taskId: TaskId,
		retryStrategy: RetryStrategy,
		currentAttempt: number,
		spinThresholdMs: number,
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
				const output = await this.parse(handle, this.params.schema?.output, outputRaw, logger);
				return { output, lastAttempt: attempts };
			} catch (error) {
				if (
					error instanceof WorkflowRunSuspendedError ||
					error instanceof WorkflowRunFailedError ||
					error instanceof WorkflowRunRevisionConflictError ||
					error instanceof TaskConflictError
				) {
					throw error;
				}

				const serializableError = createSerializableError(error);

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					logger.error("Task failed", {
						"aiki.attempts": attempts,
						"aiki.reason": serializableError.message,
					});
					await handle[INTERNAL].transitionTaskState(address, {
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

				if (retryParams.delayMs <= spinThresholdMs) {
					await delay(retryParams.delayMs);
					attempts++;
					continue;
				}

				await handle[INTERNAL].transitionTaskState(address, {
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

	private async assertUniqueTaskReferenceId(
		handle: WorkflowRunHandle<unknown, unknown, unknown, EventsDefinition>,
		existingTaskInfo: TaskInfo,
		inputHash: string,
		reference: TaskReferenceOptions | undefined,
		logger: Logger
	) {
		if (existingTaskInfo.inputHash !== inputHash && reference) {
			const conflictPolicy = reference.conflictPolicy ?? "error";
			if (conflictPolicy !== "error") {
				return;
			}
			logger.error("Reference ID already used by another task", {
				"aiki.taskName": this.name,
				"aiki.referenceId": reference.id,
				"aiki.existingTaskId": existingTaskInfo.id,
			});
			const error = new WorkflowRunFailedError(
				handle.run.id as WorkflowRunId,
				handle.run.attempts,
				`Reference ID "${reference.id}" already used by another task ${existingTaskInfo.id}`
			);
			await handle[INTERNAL].transitionState({
				status: "failed",
				cause: "self",
				error: createSerializableError(error),
			});
			throw error;
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
		handle: WorkflowRunHandle<unknown, unknown, unknown, EventsDefinition>,
		schema: StandardSchemaV1<T> | undefined,
		data: unknown,
		logger: Logger
	): Promise<T> {
		if (!schema) {
			return data as T;
		}

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

class TaskBuilderImpl<Input, Output> implements TaskBuilder<Input, Output> {
	constructor(
		private readonly task: TaskImpl<Input, Output>,
		private readonly startOptsBuilder: ObjectBuilder<TaskStartOptions>
	) {}

	opt<Path extends PathFromObject<TaskStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskStartOptions, Path>
	): TaskBuilder<Input, Output> {
		return new TaskBuilderImpl(this.task, this.startOptsBuilder.with(path, value));
	}

	start(
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		return this.task.startWithOpts(run, this.startOptsBuilder.build(), ...args);
	}
}
