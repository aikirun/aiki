import { isNonEmptyArray } from "@aikirun/lib/array";
import { delay } from "@aikirun/lib/async";
import { sha256 } from "@aikirun/lib/crypto";
import { createSerializableError, type SerializableInput } from "@aikirun/lib/error";
import { stableStringify } from "@aikirun/lib/json";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { getRetryParams } from "@aikirun/lib/retry";
import type { Logger } from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { TaskPath } from "@aikirun/types/task";
import { TaskFailedError, type TaskId } from "@aikirun/types/task";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow-run";
import type { WorkflowRunContext } from "@aikirun/workflow";
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
 * @param params.id - Unique task id used for execution tracking
 * @param params.handler - Async function that executes the task logic
 * @returns Task instance with retry and option configuration methods
 *
 * @example
 * ```typescript
 * // Simple task without retry
 * export const sendEmail = task({
 *   id: "send-email",
 *   handler(input: { email: string; message: string }) {
 *     return emailService.send(input.email, input.message);
 *   },
 * });
 *
 * // Task with retry configuration
 * export const chargeCard = task({
 *   id: "charge-card",
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
export function task<Input extends SerializableInput = null, Output = void>(
	params: TaskParams<Input, Output>
): Task<Input, Output> {
	return new TaskImpl(params);
}

export interface TaskParams<Input, Output> {
	id: string;
	handler: (input: Input) => Promise<Output>;
	opts?: TaskOptions;
}

export interface TaskOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
}

export interface TaskBuilder<Input, Output> {
	opt<Path extends PathFromObject<TaskOptions>>(
		path: Path,
		value: TypeOfValueAtPath<TaskOptions, Path>
	): TaskBuilder<Input, Output>;
	start: Task<Input, Output>["start"];
}

export interface Task<Input, Output> {
	id: TaskId;
	with(): TaskBuilder<Input, Output>;
	start: <WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput, EventsDefinition>,
		...args: Input extends null ? [] : [Input]
	) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly id: TaskId;

	constructor(private readonly params: TaskParams<Input, Output>) {
		this.id = params.id as TaskId;
	}

	public with(): TaskBuilder<Input, Output> {
		const optsOverrider = objectOverrider(this.params.opts ?? {});

		const createBuilder = (optsBuilder: ReturnType<typeof optsOverrider>): TaskBuilder<Input, Output> => ({
			opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
			start: (run, ...args) => new TaskImpl({ ...this.params, opts: optsBuilder.build() }).start(run, ...args),
		});

		return createBuilder(optsOverrider());
	}

	public async start<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput, EventsDefinition>,
		...args: Input extends null ? [] : [Input]
	): Promise<Output> {
		const handle = run[INTERNAL].handle;

		handle[INTERNAL].assertExecutionAllowed();

		const input = isNonEmptyArray(args) ? args[0] : (null as Input); // this cast is okay cos if args is empty, Input must be type null;

		const path = await this.getPath(input);

		const taskState = handle.run.tasksState[path] ?? { status: "none" };
		if (taskState.status === "completed") {
			return taskState.output as Output;
		}
		if (taskState.status === "failed") {
			throw new TaskFailedError(path, taskState.attempts, taskState.error.message);
		}

		const logger = run.logger.child({
			"aiki.component": "task-execution",
			"aiki.taskPath": path,
		});

		let attempts = 0;
		const retryStrategy = this.params.opts?.retry ?? { type: "never" };

		if (taskState.status !== "none") {
			this.assertRetryAllowed(path, taskState.attempts, retryStrategy, logger);
			logger.debug("Retrying task", {
				"aiki.attempts": taskState.attempts,
				"aiki.taskStatus": taskState.status,
			});
			attempts = taskState.attempts;
		}

		if (taskState.status === "awaiting_retry" && handle.run.state.status === "running") {
			throw new WorkflowRunSuspendedError(run.id);
		}

		attempts++;

		logger.info("Starting task", { "aiki.attempts": attempts });
		await handle[INTERNAL].transitionTaskState(path, { status: "running", attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(run, input, path, retryStrategy, attempts, logger);

		await handle[INTERNAL].transitionTaskState(path, { status: "completed", output });
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput, EventsDefinition>,
		input: Input,
		path: TaskPath,
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
					await run[INTERNAL].handle[INTERNAL].transitionTaskState(path, {
						status: "failed",
						attempts,
						error: serializableError,
					});
					throw new TaskFailedError(path, attempts, serializableError.message);
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

				await run[INTERNAL].handle[INTERNAL].transitionTaskState(path, {
					status: "awaiting_retry",
					attempts,
					error: serializableError,
					nextAttemptInMs: retryParams.delayMs,
				});
				throw new WorkflowRunSuspendedError(run.id);
			}
		}
	}

	private assertRetryAllowed(path: TaskPath, attempts: number, retryStrategy: RetryStrategy, logger: Logger): void {
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Task retry not allowed", {
				"aiki.attempts": attempts,
			});
			throw new TaskFailedError(path, attempts, "Task retry not allowed");
		}
	}

	private async getPath(input: Input): Promise<TaskPath> {
		const inputHash = await sha256(stableStringify(input));

		const taskPath = this.params.opts?.idempotencyKey
			? `${this.id}/${inputHash}/${this.params.opts.idempotencyKey}`
			: `${this.id}/${inputHash}`;

		return taskPath as TaskPath;
	}
}
