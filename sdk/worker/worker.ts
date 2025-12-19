import {
	type WorkflowRun,
	WorkflowRunCancelledError,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	WorkflowSuspendedError,
} from "@aikirun/types/workflow-run";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { NonEmptyArray } from "@aikirun/lib/array";
import { INTERNAL } from "@aikirun/types/symbols";
import { delay, fireAndForget } from "@aikirun/lib/async";
import type { Client, Logger, SubscriberStrategy } from "@aikirun/client";
import type { ResolvedSubscriberStrategy, SubscriberMessageMeta, WorkflowRunBatch } from "@aikirun/client";
import {
	workflowRegistry,
	workflowRunHandle,
	createWorkflowRunSleeper,
	type WorkflowRegistry,
} from "@aikirun/workflow";
import type { WorkflowId, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowVersion } from "@aikirun/workflow";
import { isServerConflictError } from "@aikirun/lib/error";
import { TaskFailedError } from "@aikirun/types/task";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";

/**
 * Creates an Aiki worker definition for executing workflows.
 *
 * Worker definitions are static and reusable. Call `spawn(client)` to begin
 * execution, which returns a handle for controlling the running worker.
 *
 * @param params - Worker configuration parameters
 * @param params.id - Unique worker ID for identification and monitoring
 * @param params.workflows - Array of workflow versions this worker can execute
 * @param params.subscriber - Message subscriber strategy (default: redis_streams)
 * @returns Worker definition, call spawn(client) to begin execution
 *
 * @example
 * ```typescript
 * export const myWorker = worker({
 *   id: "order-worker",
 *   workflows: [orderWorkflowV1, paymentWorkflowV1],
 *   opts: {
 *     maxConcurrentWorkflowRuns: 10,
 *   },
 * });
 *
 * const handle = await myWorker.spawn(client);
 *
 * process.on("SIGINT", async () => {
 *   await handle.stop();
 *   await client.close();
 * });
 * ```
 */
export function worker(params: WorkerParams): Worker {
	return new WorkerImpl(params);
}

export interface WorkerParams {
	id: string;
	// biome-ignore lint/suspicious/noExplicitAny:
	workflows: WorkflowVersion<any, any, any>[];
	subscriber?: SubscriberStrategy;
	opts?: WorkerOptions;
}

export interface WorkerOptions {
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: {
		heartbeatIntervalMs?: number;
		/**
		 * Threshold for spinning vs persisting delays (default: 10ms).
		 *
		 * Delays <= threshold: In-memory wait (fast, no history, not durable)
		 * Delays > threshold: Server state transition (history recorded, durable)
		 *
		 * Set to 0 to record all delays in transition history.
		 */
		spinThresholdMs?: number;
	};
	gracefulShutdownTimeoutMs?: number;
	/**
	 * Optional array of shardKeys this worker should process.
	 * When provided, the worker will only subscribe to sharded streams.
	 * When omitted, the worker subscribes to default streams.
	 */
	shardKeys?: string[];
}

export interface WorkerBuilder {
	opt<Path extends PathFromObject<WorkerOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerOptions, Path>
	): WorkerBuilder;
	spawn: Worker["spawn"];
}

export interface Worker {
	id: string;
	with(): WorkerBuilder;
	spawn: <AppContext>(client: Client<AppContext>) => Promise<WorkerHandle>;
}

export interface WorkerHandle {
	id: string;
	stop: () => Promise<void>;
}

class WorkerImpl implements Worker {
	public readonly id: string;

	constructor(private readonly params: WorkerParams) {
		this.id = params.id;
	}

	public with(): WorkerBuilder {
		const optsOverrider = objectOverrider(this.params.opts ?? {});

		const createBuilder = (optsBuilder: ReturnType<typeof optsOverrider>): WorkerBuilder => ({
			opt: (path, value) => createBuilder(optsBuilder.with(path, value)),
			spawn: (client) => new WorkerImpl({ ...this.params, opts: optsBuilder.build() }).spawn(client),
		});

		return createBuilder(optsOverrider());
	}

	public async spawn<AppContext>(client: Client<AppContext>): Promise<WorkerHandle> {
		const handle = new WorkerHandleImpl(client, this.params);
		await handle._start();
		return handle;
	}
}

interface ActiveWorkflowRun {
	run: WorkflowRun;
	executionPromise: Promise<void>;
	meta?: SubscriberMessageMeta;
}

class WorkerHandleImpl<AppContext> implements WorkerHandle {
	public readonly id: string;
	private readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private subscriberStrategy: ResolvedSubscriberStrategy | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		private readonly client: Client<AppContext>,
		private readonly params: WorkerParams
	) {
		this.id = params.id;
		this.registry = workflowRegistry().addMany(this.params.workflows);

		this.logger = client.logger.child({
			"aiki.component": "worker",
			"aiki.workerId": this.id,
		});
	}

	async _start(): Promise<void> {
		this.logger.info("Worker starting");

		const subscriberStrategyBuilder = this.client[INTERNAL].subscriber.create(
			this.params.subscriber ?? { type: "redis_streams" },
			this.registry.getAll(),
			this.params.opts?.shardKeys
		);
		this.subscriberStrategy = await subscriberStrategyBuilder.init(this.id, {
			onError: (error: Error) => this.handleNotificationError(error),
			onStop: () => this.stop(),
		});

		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		fireAndForget(this.poll(abortSignal), (error) => {
			if (!abortSignal.aborted) {
				this.logger.error("Unexpected error", {
					"aiki.error": error.message,
				});
			}
		});
	}

	public async stop(): Promise<void> {
		this.logger.info("Worker stopping");

		this.abortController?.abort();

		const activeWorkflowRuns = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRuns.length === 0) return;

		const timeoutMs = this.params.opts?.gracefulShutdownTimeoutMs ?? 5_000;

		if (timeoutMs > 0) {
			await Promise.race([Promise.allSettled(activeWorkflowRuns.map((w) => w.executionPromise)), delay(timeoutMs)]);
		}

		const stillActive = Array.from(this.activeWorkflowRunsById.values());
		if (stillActive.length > 0) {
			const ids = stillActive.map((w) => w.run.id).join(", ");
			this.logger.warn("Worker shutdown with active workflows", {
				"aiki.activeWorkflowRunIds": ids,
			});
		}

		this.activeWorkflowRunsById.clear();
	}

	private async poll(abortSignal: AbortSignal): Promise<void> {
		this.logger.info("Worker started");

		if (!this.subscriberStrategy) {
			throw new Error("Subscriber strategy not initialized");
		}

		let nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: false });
		let subscriberFailedAttempts = 0;

		while (!abortSignal.aborted) {
			await delay(nextDelayMs, { abortSignal });

			const availableCapacity = (this.params.opts?.maxConcurrentWorkflowRuns ?? 1) - this.activeWorkflowRunsById.size;

			if (availableCapacity <= 0) {
				nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "at_capacity" });
				continue;
			}

			const nextBatchResponse = await this.fetchNextWorkflowRunBatch(availableCapacity);
			if (!nextBatchResponse.success) {
				subscriberFailedAttempts++;

				nextDelayMs = this.subscriberStrategy.getNextDelay({
					type: "retry",
					attemptNumber: subscriberFailedAttempts,
				});
				continue;
			}

			subscriberFailedAttempts = 0;

			if (!isNonEmptyArray(nextBatchResponse.batch)) {
				nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: false });
				continue;
			}

			await this.enqueueWorkflowRunBatch(nextBatchResponse.batch, abortSignal);
			nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: true });
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number
	): Promise<{ success: true; batch: WorkflowRunBatch[] } | { success: false; error: Error }> {
		if (!this.subscriberStrategy) {
			return {
				success: false,
				error: new Error("Subscriber strategy not initialized"),
			};
		}

		try {
			const batch = await this.subscriberStrategy.getNextBatch(size);
			return {
				success: true,
				batch,
			};
		} catch (error) {
			this.logger.error("Error getting next workflow runs batch", {
				"aiki.error": error instanceof Error ? error.message : String(error),
			});

			return {
				success: false,
				error: error as Error,
			};
		}
	}

	private async enqueueWorkflowRunBatch(
		batch: NonEmptyArray<WorkflowRunBatch>,
		abortSignal: AbortSignal
	): Promise<void> {
		for (const { data, meta } of batch) {
			const { workflowRunId } = data;

			if (this.activeWorkflowRunsById.has(workflowRunId)) {
				this.logger.info("Workflow already running", {
					"aiki.workflowRunId": workflowRunId,
				});
				continue;
			}

			const { run: workflowRun } = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
			if (!workflowRun) {
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			const workflowVersion = this.registry.get(
				workflowRun.workflowId as WorkflowId,
				workflowRun.workflowVersionId as WorkflowVersionId
			);
			if (!workflowVersion) {
				this.logger.warn("Workflow version not found", {
					"aiki.workflowId": workflowRun.workflowId,
					"aiki.workflowVersionId": workflowRun.workflowVersionId,
					"aiki.workflowRunId": workflowRun.id,
				});
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			if (abortSignal.aborted) break;

			const workflowExecutionPromise = this.executeWorkflow(workflowRun, workflowVersion, meta);

			this.activeWorkflowRunsById.set(workflowRun.id, {
				run: workflowRun,
				executionPromise: workflowExecutionPromise,
				meta,
			});
		}
	}

	private async executeWorkflow(
		workflowRun: WorkflowRun,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
		meta?: SubscriberMessageMeta
	): Promise<void> {
		const logger = this.logger.child({
			"aiki.component": "workflow-execution",
			"aiki.workflowId": workflowRun.workflowId,
			"aiki.workflowVersionId": workflowRun.workflowVersionId,
			"aiki.workflowRunId": workflowRun.id,
			...(meta && {
				"aiki.messageId": meta.messageId,
			}),
		});

		let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
		let shouldAcknowledge = false;

		try {
			const handle = await workflowRunHandle(this.client, workflowRun, logger);

			const appContext = this.client[INTERNAL].contextFactory
				? await this.client[INTERNAL].contextFactory(workflowRun)
				: null;

			const heartbeat = this.subscriberStrategy?.heartbeat;
			if (meta && heartbeat) {
				heartbeatInterval = setInterval(() => {
					try {
						heartbeat(workflowRun.id as WorkflowRunId, meta);
					} catch (error) {
						logger.warn("Failed to send heartbeat", {
							"aiki.error": error instanceof Error ? error.message : String(error),
						});
					}
				}, this.params.opts?.workflowRun?.heartbeatIntervalMs ?? 30_000);
			}

			await workflowVersion[INTERNAL].exec(
				workflowRun.input,
				{
					id: workflowRun.id as WorkflowRunId,
					workflowId: workflowRun.workflowId as WorkflowId,
					workflowVersionId: workflowRun.workflowVersionId as WorkflowVersionId,
					options: workflowRun.options,
					logger,
					sleep: createWorkflowRunSleeper(handle, logger, {
						spinThresholdMs: this.params.opts?.workflowRun?.spinThresholdMs ?? 10,
					}),
					[INTERNAL]: { handle },
				},
				appContext
			);

			shouldAcknowledge = true;
			logger.info("Workflow execution completed");
		} catch (error) {
			if (
				error instanceof WorkflowRunNotExecutableError ||
				error instanceof WorkflowRunCancelledError ||
				error instanceof WorkflowRunFailedError ||
				error instanceof TaskFailedError ||
				error instanceof WorkflowSuspendedError ||
				isServerConflictError(error)
			) {
				shouldAcknowledge = true;
			} else {
				logger.error("Unexpected error during workflow execution", {
					"aiki.error": error instanceof Error ? error.message : String(error),
					"aiki.stack": error instanceof Error ? error.stack : undefined,
				});
				shouldAcknowledge = false;
			}
		} finally {
			if (heartbeatInterval) clearInterval(heartbeatInterval);

			if (meta && this.subscriberStrategy?.acknowledge) {
				if (shouldAcknowledge) {
					try {
						await this.subscriberStrategy.acknowledge(workflowRun.id as WorkflowRunId, meta);
					} catch (error) {
						logger.error("Failed to acknowledge message, it may be reprocessed", {
							"aiki.errorType": "MESSAGE_ACK_FAILED",
							"aiki.error": error instanceof Error ? error.message : String(error),
						});
					}
				} else {
					logger.debug("Message left in PEL for retry");
				}
			}

			this.activeWorkflowRunsById.delete(workflowRun.id);
		}
	}

	private handleNotificationError(error: Error): void {
		this.logger.warn("Notification error, falling back to polling", {
			"aiki.error": error.message,
			"aiki.stack": error.stack,
		});
	}
}
