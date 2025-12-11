import {
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunNotExecutableError,
	WorkflowSleepingError,
} from "@aikirun/types/workflow-run";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { NonEmptyArray } from "@aikirun/lib/array";
import { delay, fireAndForget } from "@aikirun/lib/async";
import { toMilliseconds } from "@aikirun/lib/duration";
import type { Duration } from "@aikirun/lib/duration";
import type { Client, Logger, SubscriberStrategy } from "@aikirun/client";
import { getChildLogger } from "@aikirun/client";
import type { ResolvedSubscriberStrategy, SubscriberMessageMeta, WorkflowRunBatch } from "@aikirun/client";
import { initWorkflowRegistry, initWorkflowRunHandle, type WorkflowRegistry } from "@aikirun/workflow";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunHandle, WorkflowVersion } from "@aikirun/workflow";
import { isServerConflictError } from "@aikirun/lib/error";
import { TaskFailedError } from "@aikirun/types/task";

/**
 * Creates an Aiki worker for executing workflows and tasks.
 *
 * Workers poll for workflow runs, execute them, and handle state persistence.
 * Multiple workers can be started to scale workflow execution horizontally.
 * All workers connect to the same Aiki server and Redis instance.
 *
 * @template AppContext - Type of application context passed to workflows
 * @param client - Configured Aiki client instance
 * @param params - Worker configuration parameters
 * @param params.id - Optional unique worker ID (auto-generated if not provided)
 * @param params.maxConcurrentWorkflowRuns - Maximum concurrent workflows to execute (default: 1)
 * @param params.workflowRun.heartbeatIntervalMs - Heartbeat interval in milliseconds (default: 30000)
 * @param params.gracefulShutdownTimeoutMs - Time to wait for active workflows during shutdown (default: 5000)
 * @param params.subscriber - Message subscriber strategy (default: redis_streams)
 * @param params.shardKeys - Optional shard keys for distributed work
 * @returns Worker instance ready to be started
 *
 * @example
 * ```typescript
 * const worker = worker(aiki, {
 *   id: "worker-1",
 *   maxConcurrentWorkflowRuns: 10,
 *   subscriber: { type: "redis_streams" },
 * });
 *
 * // Register workflows
 * worker.registry
 *   .add(userOnboardingWorkflow)
 *   .add(paymentWorkflow);
 *
 * // Start execution
 * await worker.start();
 *
 * // Handle graceful shutdown
 * const shutdown = async () => {
 *   await worker.stop();
 *   await aiki.close();
 * };
 * processWrapper.addSignalListener("SIGINT", shutdown);
 * ```
 */
export function worker<AppContext>(client: Client<AppContext>, params: WorkerParams): Worker {
	return new WorkerImpl(client, params);
}

export interface WorkerParams {
	id?: string;
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: {
		heartbeatIntervalMs?: number;
	};
	gracefulShutdownTimeoutMs?: number;
	subscriber?: SubscriberStrategy;
	/**
	 * Optional array of shardKeys this worker should process.
	 * When provided, the worker will only subscribe to sharded streams: workflow:${workflowName}:${Key}
	 * When omitted, the worker subscribes to default streams: workflow:${workflowName}
	 * Cannot be combined with non-sharded workflows in the same worker instance.
	 */
	shardKeys?: string[];
}

export interface Worker {
	id: string;
	registry: WorkflowRegistry;
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

interface ActiveWorkflowRun {
	run: WorkflowRun;
	executionPromise: Promise<void>;
	meta?: SubscriberMessageMeta;
}

class WorkerImpl<AppContext> implements Worker {
	public readonly id: string;
	public readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private subscriberStrategy: ResolvedSubscriberStrategy | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		private readonly client: Client<AppContext>,
		private readonly params: WorkerParams
	) {
		this.id = params.id ?? crypto.randomUUID();
		this.registry = initWorkflowRegistry();

		this.logger = getChildLogger(client.logger, {
			"aiki.component": "worker",
			"aiki.workerId": this.id,
		});

		this.logger.info("Worker initialized");
	}

	public async start(): Promise<void> {
		this.logger.info("Worker starting");

		const subscriberStrategyBuilder = this.client._internal.subscriber.create(
			this.params.subscriber ?? { type: "redis_streams" },
			this.registry._internal.getAll().map((workflow) => workflow.name),
			this.params.shardKeys
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

		const timeoutMs = this.params.gracefulShutdownTimeoutMs ?? 5_000;

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

			const availableCapacity = (this.params.maxConcurrentWorkflowRuns ?? 1) - this.activeWorkflowRunsById.size;

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
				// Debug: Skip already running workflows
				continue;
			}

			const { run: workflowRun } = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
			if (!workflowRun) {
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			const workflow = this.registry._internal.get(workflowRun.name as WorkflowName);
			if (!workflow) {
				this.logger.warn("Workflow not found in registry", {
					"aiki.workflowName": workflowRun.name,
					"aiki.workflowRunId": workflowRun.id,
				});
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			const workflowVersion = workflow._internal.getVersion(workflowRun.versionId as WorkflowVersionId);
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
		const logger = getChildLogger(this.logger, {
			"aiki.component": "workflow-execution",
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
			...(meta && {
				"aiki.messageId": meta.messageId,
			}),
		});

		// Using any cos setInterval returns different types on Deno and Node
		// deno-lint-ignore no-explicit-any
		let heartbeatInterval: any | undefined;
		let shouldAcknowledge = false;

		try {
			const workflowRunHandle = initWorkflowRunHandle(this.client.api, workflowRun, logger);

			const appContext = this.client._internal.contextFactory
				? await this.client._internal.contextFactory(workflowRun)
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
				}, this.params.workflowRun?.heartbeatIntervalMs ?? 30_000);
			}

			await workflowVersion._internal.exec(
				workflowRun.input,
				{
					id: workflowRun.id as WorkflowRunId,
					name: workflowRun.name as WorkflowName,
					versionId: workflowRun.versionId as WorkflowVersionId,
					options: workflowRun.options,
					handle: workflowRunHandle,
					logger,
					sleep: createWorkflowRunSleeper(workflowRunHandle, logger),
				},
				appContext
			);

			shouldAcknowledge = true;
			logger.info("Workflow execution completed");
		} catch (error) {
			if (
				error instanceof WorkflowRunNotExecutableError ||
				error instanceof WorkflowRunFailedError ||
				error instanceof TaskFailedError ||
				error instanceof WorkflowSleepingError ||
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

function createWorkflowRunSleeper(workflowRunHandle: WorkflowRunHandle<unknown, unknown>, logger: Logger) {
	return async (duration: Duration) => {
		const durationMs = toMilliseconds(duration);
		const awakeAt = Date.now() + durationMs;
		logger.info("Workflow sleeping", { "aiki.durationMs": durationMs });

		await workflowRunHandle.transitionState({ status: "sleeping", awakeAt });

		throw new WorkflowSleepingError(workflowRunHandle.run.id as WorkflowRunId);
	};
}
