import { sha256 } from "@aikirun/lib/crypto";
import { delay } from "@aikirun/lib/async";
import { INTERNAL } from "@aikirun/types/symbols";
import { getRetryParams } from "@aikirun/lib/retry";
import type { RetryStrategy } from "@aikirun/lib/retry";
import { stableStringify } from "@aikirun/lib/json";
import { createSerializableError, type SerializableInput } from "@aikirun/lib/error";
import { TaskFailedError, type TaskId } from "@aikirun/types/task";
import type { WorkflowRunContext } from "@aikirun/workflow";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { TaskStateFailed } from "@aikirun/types/task";
import type { Logger } from "@aikirun/types/client";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";

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
 * @param params.exec - Async function that executes the task logic
 * @returns Task instance with retry and option configuration methods
 *
 * @example
 * ```typescript
 * // Simple task without retry
 * export const sendEmail = task({
 *   id: "send-email",
 *   exec(input: { email: string; message: string }) {
 *     return emailService.send(input.email, input.message);
 *   },
 * });
 *
 * // Task with retry configuration
 * export const chargeCard = task({
 *   id: "charge-card",
 *   exec(input: { cardId: string; amount: number }) {
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
	exec: (input: Input) => Promise<Output>;
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
		runCtx: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
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
			start: (runCtx, ...args) => new TaskImpl({ ...this.params, opts: optsBuilder.build() }).start(runCtx, ...args),
		});

		return createBuilder(optsOverrider());
	}

	public async start<WorkflowInput, WorkflowOutput>(
		runCtx: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		...args: Input extends null ? [] : [Input]
	): Promise<Output> {
		const handle = runCtx.handle;

		await handle[INTERNAL].assertExecutionAllowed();

		const input = isNonEmptyArray(args)
			? args[0]
			: // this cast is okay cos if args is empty, Input must be type null
				(null as Input);

		const path = await this.getPath(runCtx, input);

		const taskState = handle[INTERNAL].getTaskState(path);
		if (taskState.status === "completed") {
			return taskState.output as Output;
		}

		const logger = runCtx.logger.child({
			"aiki.component": "task-execution",
			"aiki.taskId": this.id,
			"aiki.taskPath": path,
		});

		let attempts = 0;
		const retryStrategy = this.params.opts?.retry ?? { type: "never" };

		if ("attempts" in taskState) {
			this.assertRetryAllowed(taskState.attempts, retryStrategy, logger);
			logger.warn("Retrying task", {
				"aiki.attempts": taskState.attempts,
				"aiki.taskStatus": taskState.status,
			});
			attempts = taskState.attempts;
		}

		if (taskState.status === "failed") {
			// TODO: this is spin based delay, if the delay is large enough,
			// it might be more profitable to add task to waiting queue,
			// letting the serve schedule it at a later time.
			// Thefore, releasing worker resources
			await this.delayIfNecessary(taskState);
		}

		attempts++;

		logger.info("Starting task", { "aiki.attempts": attempts });
		await handle[INTERNAL].transitionTaskState(path, { status: "running", attempts });

		const { output, lastAttempt } = await this.tryExecuteTask(runCtx, input, path, retryStrategy, attempts, logger);

		await handle[INTERNAL].transitionTaskState(path, { status: "completed", output });
		logger.info("Task complete", { "aiki.attempts": lastAttempt });

		return output;
	}

	private async tryExecuteTask<WorkflowInput, WorkflowOutput>(
		runCtx: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		input: Input,
		path: string,
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
			const attemptedAt = Date.now();
			try {
				const output = await this.params.exec(input);
				return { output, lastAttempt: attempts };
			} catch (error) {
				const serializableError = createSerializableError(error);
				const taskFailedState: TaskStateFailed = {
					status: "failed",
					reason: serializableError.message,
					attempts,
					attemptedAt,
					error: serializableError,
				};

				const retryParams = getRetryParams(attempts, retryStrategy);
				if (!retryParams.retriesLeft) {
					await runCtx.handle[INTERNAL].transitionTaskState(path, taskFailedState);
					logger.error("Task failed", {
						"aiki.attempts": attempts,
						"aiki.reason": taskFailedState.reason,
					});
					throw new TaskFailedError(this.id, attempts, taskFailedState.reason);
				}

				const nextAttemptAt = Date.now() + retryParams.delayMs;

				await runCtx.handle[INTERNAL].transitionTaskState(path, { ...taskFailedState, nextAttemptAt });
				logger.debug("Task failed. Retrying", {
					"aiki.attempts": attempts,
					"aiki.nextAttemptAt": nextAttemptAt,
					"aiki.reason": taskFailedState.reason,
				});

				await delay(retryParams.delayMs);
				attempts++;
			}
		}
	}

	private assertRetryAllowed(attempts: number, retryStrategy: RetryStrategy, logger: Logger): void {
		const retryParams = getRetryParams(attempts, retryStrategy);
		if (!retryParams.retriesLeft) {
			logger.error("Task retry not allowed", {
				"aiki.attempts": attempts,
			});
			throw new TaskFailedError(this.id, attempts, "Task retry not allowed");
		}
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
		runCtx: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		input: Input
	): Promise<string> {
		// TODO: we don't need workflowid in task path
		const workflowRunPath = `${runCtx.workflowId}/${runCtx.workflowVersionId}/${runCtx.id}`;

		const inputHash = await sha256(stableStringify(input));

		return this.params.opts?.idempotencyKey
			? `${workflowRunPath}/${this.id}/${inputHash}/${this.params.opts.idempotencyKey}`
			: `${workflowRunPath}/${this.id}/${inputHash}`;
	}
}
