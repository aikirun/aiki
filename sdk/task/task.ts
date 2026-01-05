import { isNonEmptyArray } from "@aikirun/lib/array";
import { delay } from "@aikirun/lib/async";
import { hashInput } from "@aikirun/lib/crypto";
import { createSerializableError } from "@aikirun/lib/error";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import { getTaskPath } from "@aikirun/lib/path";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { getRetryParams } from "@aikirun/lib/retry";
import type { Logger } from "@aikirun/types/client";
import type { Serializable } from "@aikirun/types/serializable";
import { INTERNAL } from "@aikirun/types/symbols";
import type {
	TaskId,
	TaskInfo,
	TaskOptions,
	TaskReferenceOptions,
	TaskStateAwaitingRetry,
	TaskStateRunning,
} from "@aikirun/types/task";
import { TaskFailedError, type TaskName } from "@aikirun/types/task";
import { WorkflowRunFailedError, type WorkflowRunId, WorkflowRunSuspendedError } from "@aikirun/types/workflow-run";
import type { WorkflowRunContext, WorkflowRunHandle } from "@aikirun/workflow";
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
	opts?: TaskOptions;
}

export interface TaskBuilder<Input, Output> {
	opt<Path extends PathFromObject<TaskOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskOptions, Path>
	): TaskBuilder<Input, Output>;
	start: Task<Input, Output>["start"];
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
		const optsOverrider = objectOverrider(this.params.opts ?? {});

		const createBuilder = (optsBuilder: ReturnType<typeof optsOverrider>): TaskBuilder<Input, Output> => ({
			opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
			start: (run, ...args) => new TaskImpl({ ...this.params, opts: optsBuilder.build() }).start(run, ...args),
		});

		return createBuilder(optsOverrider());
	}

	public async start(
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		...args: Input extends void ? [] : [Input]
	): Promise<Output> {
		const handle = run[INTERNAL].handle;
		handle[INTERNAL].assertExecutionAllowed();

		const input = isNonEmptyArray(args) ? args[0] : (undefined as Input);
		const inputHash = await hashInput(input);

		const reference = this.params.opts?.reference;
		const path = getTaskPath(this.name, reference?.id ?? inputHash);
		const existingTaskInfo = handle.run.tasks[path];
		if (existingTaskInfo) {
			await this.assertUniqueTaskReferenceId(handle, existingTaskInfo, inputHash, reference, run.logger);
		}

		if (existingTaskInfo?.state.status === "completed") {
			return existingTaskInfo.state.output as Output;
		}
		if (existingTaskInfo?.state.status === "failed") {
			const { state } = existingTaskInfo;
			throw new TaskFailedError(existingTaskInfo.id as TaskId, state.attempts, state.error.message);
		}

		let attempts = 0;
		const retryStrategy = this.params.opts?.retry ?? { type: "never" };

		if (existingTaskInfo?.state) {
			const taskId = existingTaskInfo.id as TaskId;
			const state = existingTaskInfo?.state;

			this.assertRetryAllowed(taskId, state, retryStrategy, run.logger);

			run.logger.debug("Retrying task", {
				"aiki.taskId": taskId,
				"aiki.attempts": state.attempts,
				"aiki.taskStatus": state.status,
			});
			attempts = state.attempts;

			if (state.status === "awaiting_retry" && handle.run.state.status === "running") {
				throw new WorkflowRunSuspendedError(run.id);
			}
		}

		attempts++;

		const options: TaskOptions = { retry: retryStrategy, reference };

		const { taskId } = existingTaskInfo
			? await handle[INTERNAL].transitionTaskState({
					type: "retry",
					taskId: existingTaskInfo.id,
					options,
					taskState: { status: "running", attempts, input },
				})
			: await handle[INTERNAL].transitionTaskState({
					type: "create",
					taskName: this.name,
					options,
					taskState: { status: "running", attempts, input },
				});

		const logger = run.logger.child({
			"aiki.component": "task-execution",
			"aiki.taskId": taskId,
		});
		logger.info("Task started", { "aiki.attempts": attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(run, input, taskId, retryStrategy, attempts, logger);

		await handle[INTERNAL].transitionTaskState({
			taskId,
			taskState: { status: "completed", attempts: lastAttempt, output },
		});
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask(
		run: WorkflowRunContext<unknown, unknown, EventsDefinition>,
		input: Input,
		taskId: TaskId,
		retryStrategy: RetryStrategy,
		currentAttempt: number,
		logger: Logger
	): Promise<{ output: Output; lastAttempt: number }> {
		let attempts = currentAttempt;

		// TODO: Add test cases for this:
		// Infra changes like transitioning of task state should not consume retry budged
		// Even if task crashes while trying to transition state, it will be picked up
		// by another worker, who will detect either fail the task if retry budget is
		// exhaused or retry the task

		while (true) {
			try {
				const output = await this.params.handler(input);
				return { output, lastAttempt: attempts };
			} catch (error) {
				const serializableError = createSerializableError(error);

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					logger.error("Task failed", {
						"aiki.attempts": attempts,
						"aiki.reason": serializableError.message,
					});
					await run[INTERNAL].handle[INTERNAL].transitionTaskState({
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

				if (retryParams.delayMs <= run[INTERNAL].options.spinThresholdMs) {
					await delay(retryParams.delayMs);
					attempts++;
					continue;
				}

				await run[INTERNAL].handle[INTERNAL].transitionTaskState({
					taskId,
					taskState: {
						status: "awaiting_retry",
						attempts,
						error: serializableError,
						nextAttemptInMs: retryParams.delayMs,
					},
				});
				throw new WorkflowRunSuspendedError(run.id);
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
			const onConflict = reference.onConflict ?? "error";
			if (onConflict !== "error") {
				return;
			}
			logger.error("Reference ID already used by another task", {
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

	private assertRetryAllowed(
		taskId: TaskId,
		state: TaskStateRunning<unknown> | TaskStateAwaitingRetry,
		retryStrategy: RetryStrategy,
		logger: Logger
	): void {
		const { attempts } = state;
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Task retry not allowed", {
				"aiki.taskId": taskId,
				"aiki.attempts": attempts,
			});
			throw new TaskFailedError(taskId, attempts, "Task retry not allowed");
		}
	}
}
