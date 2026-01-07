import type {
	Client,
	Logger,
	ResolvedSubscriberStrategy,
	SubscriberMessageMeta,
	SubscriberStrategy,
	WorkflowRunBatch,
} from "@aikirun/client";
import type { NonEmptyArray } from "@aikirun/lib/array";
import { isNonEmptyArray } from "@aikirun/lib/array";
import { delay, fireAndForget } from "@aikirun/lib/async";
import { objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkerId, WorkerName } from "@aikirun/types/worker";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import {
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";
import type { WorkflowVersion } from "@aikirun/workflow";
import {
	createEventWaiters,
	createSleeper,
	type WorkflowRegistry,
	workflowRegistry,
	workflowRunHandle,
} from "@aikirun/workflow";

/**
 * Creates an Aiki worker definition for executing workflows.
 *
 * Worker definitions are static and reusable. Call `spawn(client)` to begin
 * execution, which returns a handle for controlling the running worker.
 *
 * @param params - Worker configuration parameters
 * @param params.name - Unique worker name for identification and monitoring
 * @param params.workflows - Array of workflow versions this worker can execute
 * @param params.subscriber - Message subscriber strategy (default: redis_streams)
 * @returns Worker definition, call spawn(client) to begin execution
 *
 * @example
 * ```typescript
 * export const myWorker = worker({
 *   name: "order-worker",
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
	name: string;
	// biome-ignore lint/suspicious/noExplicitAny: AppContext is contravariant
	workflows: WorkflowVersion<any, any, any, any>[];
	subscriber?: SubscriberStrategy;
	opts?: WorkerOptions;
}

export interface WorkerOptions {
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: WorkflowRunOptions;
	gracefulShutdownTimeoutMs?: number;
	/**
	 * Optional array of shards this worker should process.
	 * When provided, the worker will only subscribe to sharded streams.
	 * When omitted, the worker subscribes to default streams.
	 */
	shards?: string[];
	/**
	 * Optional reference for external correlation.
	 * Use this to associate the worker with external identifiers.
	 */
	reference?: {
		id: string;
	};
}

interface WorkflowRunOptions {
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
}

export interface WorkerBuilder {
	opt<Path extends PathFromObject<WorkerOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerOptions, Path>
	): WorkerBuilder;
	spawn: Worker["spawn"];
}

export interface Worker {
	name: WorkerName;
	with(): WorkerBuilder;
	spawn: <AppContext>(client: Client<AppContext>) => Promise<WorkerHandle>;
}

export interface WorkerHandle {
	id: WorkerId;
	name: WorkerName;
	stop: () => Promise<void>;
}

class WorkerImpl implements Worker {
	public readonly name: WorkerName;

	constructor(private readonly params: WorkerParams) {
		this.name = params.name as WorkerName;
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
	public readonly id: WorkerId;
	public readonly name: WorkerName;
	private readonly workflowRunOpts: Required<WorkflowRunOptions>;
	private readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private subscriberStrategy: ResolvedSubscriberStrategy | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		private readonly client: Client<AppContext>,
		private readonly params: WorkerParams
	) {
		this.id = crypto.randomUUID() as WorkerId;
		this.name = params.name as WorkerName;
		this.workflowRunOpts = {
			heartbeatIntervalMs: this.params.opts?.workflowRun?.heartbeatIntervalMs ?? 30_000,
			spinThresholdMs: this.params.opts?.workflowRun?.spinThresholdMs ?? 10,
		};
		this.registry = workflowRegistry().addMany(this.params.workflows);

		const reference = this.params.opts?.reference;
		this.logger = client.logger.child({
			"aiki.component": "worker",
			"aiki.workerId": this.id,
			"aiki.workerName": this.name,
			...(reference && { "aiki.workerReferenceId": reference.id }),
		});
	}

	async _start(): Promise<void> {
		const subscriberStrategyBuilder = this.client[INTERNAL].subscriber.create(
			this.params.subscriber ?? { type: "redis_streams" },
			this.registry.getAll(),
			this.params.opts?.shards
		);
		this.subscriberStrategy = await subscriberStrategyBuilder.init(this.id, {
			onError: (error: Error) => this.handleSubscriberError(error),
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
		if (activeWorkflowRuns.length === 0) {
			return;
		}

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
		if (!this.subscriberStrategy) {
			throw new Error("Subscriber strategy not initialized");
		}

		this.logger.info("Worker started");

		const maxConcurrentWorkflowRuns = this.params.opts?.maxConcurrentWorkflowRuns ?? 1;

		let nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: false });
		let subscriberFailedAttempts = 0;

		while (!abortSignal.aborted) {
			await delay(nextDelayMs, { abortSignal });

			const availableCapacity = maxConcurrentWorkflowRuns - this.activeWorkflowRunsById.size;
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

			// TODO: maybe load multiple workflows in one request
			const { run: workflowRun } = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
			if (!workflowRun) {
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			const workflowVersion = this.registry.get(
				workflowRun.name as WorkflowName,
				workflowRun.versionId as WorkflowVersionId
			);
			if (!workflowVersion) {
				this.logger.warn("Workflow version not found", {
					"aiki.workflowName": workflowRun.name,
					"aiki.workflowVersionId": workflowRun.versionId,
					"aiki.workflowRunId": workflowRun.id,
				});
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			if (abortSignal.aborted) {
				break;
			}

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
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
		});

		let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
		let shouldAcknowledge = false;

		try {
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
				}, this.workflowRunOpts.heartbeatIntervalMs);
			}

			const eventsDefinition = workflowVersion[INTERNAL].eventsDefinition;
			const handle = await workflowRunHandle(this.client, workflowRun, eventsDefinition, logger);

			const appContext = this.client[INTERNAL].contextFactory
				? await this.client[INTERNAL].contextFactory(workflowRun)
				: null;

			await workflowVersion[INTERNAL].handler(
				{
					id: workflowRun.id as WorkflowRunId,
					name: workflowRun.name as WorkflowName,
					versionId: workflowRun.versionId as WorkflowVersionId,
					options: workflowRun.options,
					logger,
					sleep: createSleeper(handle, logger),
					events: createEventWaiters(handle, eventsDefinition, logger),
					[INTERNAL]: { handle, options: { spinThresholdMs: this.workflowRunOpts.spinThresholdMs } },
				},
				workflowRun.input,
				appContext
			);

			shouldAcknowledge = true;
		} catch (error) {
			if (
				error instanceof WorkflowRunNotExecutableError ||
				error instanceof WorkflowRunSuspendedError ||
				error instanceof WorkflowRunFailedError
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

	private handleSubscriberError(error: Error): void {
		this.logger.warn("Subscriber error", {
			"aiki.error": error.message,
			"aiki.stack": error.stack,
		});
	}
}
