import type { WorkflowRun, WorkflowRunId } from "@aiki/types/workflow-run";
import { isNonEmptyArray } from "@aiki/lib/array";
import type { NonEmptyArray } from "@aiki/lib/array";
import { delay } from "@aiki/lib/async";
import type { Client, Logger, SubscriberStrategy } from "@aiki/client";
import { getChildLogger } from "@aiki/client";
import type { ResolvedSubscriberStrategy, SubscriberMessageMeta, WorkflowRunBatch } from "@aiki/client";
import { initWorkflowRegistry, initWorkflowRunHandle, type WorkflowRegistry } from "@aiki/workflow";
import type { WorkflowName, WorkflowVersionId } from "@aiki/types/workflow";
import type { WorkflowVersion } from "@aiki/workflow";

export function worker<AppContext>(
	client: Client<AppContext>,
	params: WorkerParams,
): Worker {
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
	workflowRegistry: WorkflowRegistry;
	start: () => void;
	stop: () => Promise<void>;
}

interface ActiveWorkflowRun {
	run: WorkflowRun<unknown, unknown>;
	executionPromise: Promise<void>;
	meta?: SubscriberMessageMeta;
}

class WorkerImpl<AppContext> implements Worker {
	public readonly id: string;
	public readonly workflowRegistry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private subscriberStrategy: ResolvedSubscriberStrategy | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(private readonly client: Client<AppContext>, private readonly params: WorkerParams) {
		this.id = params.id ?? crypto.randomUUID();
		this.workflowRegistry = initWorkflowRegistry();

		this.logger = getChildLogger(client._internal.logger, {
			"aiki.component": "worker",
			"aiki.workerId": this.id,
		});

		this.logger.info("Worker initialized");
	}

	public start(): void {
		this.logger.info("Worker starting");

		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		this.initAndStartPolling(abortSignal);
	}

	private async initAndStartPolling(abortSignal: AbortSignal): Promise<void> {
		const subscriberStrategyBuilder = this.client._internal.subscriber.create(
			this.params.subscriber ?? { type: "redis_streams" },
			this.workflowRegistry._internal.getAll().map((workflow) => workflow.name),
			this.params.shardKeys,
		);

		this.subscriberStrategy = await subscriberStrategyBuilder.init(this.id, {
			onError: (error: Error) => this.handleNotificationError(error),
			onStop: () => this.stop(),
		});

		try {
			await this.startPolling(abortSignal);
		} catch (error) {
			if (abortSignal.aborted) {
				this.logger.debug("Worker stopped due to abort signal");
				return;
			}

			this.logger.error("Unexpected error", {
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
		}
	}

	public async stop(): Promise<void> {
		this.logger.info("Worker stopping");

		this.abortController?.abort();

		const activeWorkflowRuns = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRuns.length === 0) return;

		const timeoutMs = this.params.gracefulShutdownTimeoutMs ?? 5_000;

		if (timeoutMs > 0) {
			try {
				await Promise.race([
					Promise.all(activeWorkflowRuns.map((w) => w.executionPromise)),
					delay(timeoutMs),
				]);
			} catch (error) {
				this.logger.warn("Error during graceful shutdown", {
					"aiki.error": error instanceof Error ? error.message : String(error),
				});
			}
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

	private async startPolling(abortSignal: AbortSignal): Promise<void> {
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

			const nextBatchResult = await this.fetchNextWorkflowRunBatch(availableCapacity);
			if (!nextBatchResult.success) {
				subscriberFailedAttempts++;

				nextDelayMs = this.subscriberStrategy.getNextDelay({
					type: "retry",
					attemptNumber: subscriberFailedAttempts,
				});
				continue;
			}

			subscriberFailedAttempts = 0;

			if (!isNonEmptyArray(nextBatchResult.batch)) {
				nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: false });
				continue;
			}

			await this.enqueueWorkflowRunBatch(nextBatchResult.batch, abortSignal);
			nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: true });
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
	): Promise<
		| { success: true; batch: WorkflowRunBatch[] }
		| { success: false; error: Error }
	> {
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
		abortSignal: AbortSignal,
	): Promise<void> {
		for (const { data, meta } of batch) {
			const { workflowRunId } = data;

			if (this.activeWorkflowRunsById.has(workflowRunId)) {
				// Debug: Skip already in progress workflows
				continue;
			}

			const { run: workflowRun } = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
			if (!workflowRun) {
				if (meta && this.subscriberStrategy?.acknowledge) {
					await this.subscriberStrategy.acknowledge(workflowRunId, meta).catch(() => {});
				}
				continue;
			}

			const workflow = this.workflowRegistry._internal.get(workflowRun.name as WorkflowName);
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
		workflowRun: WorkflowRun<unknown, unknown>,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
		meta?: SubscriberMessageMeta,
	): Promise<void> {
		const workflowLogger = getChildLogger(this.logger, {
			"aiki.component": "workflow-execution",
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
			...(meta && {
				"aiki.messageId": meta.messageId,
			}),
		});

		workflowLogger.info("Executing workflow");

		let heartbeatInterval: number | undefined;
		let workflowSucceeded = false;

		try {
			const workflowRunHandle = initWorkflowRunHandle(this.client.api, workflowRun);

			const appContext = this.client._internal.contextFactory
				? await this.client._internal.contextFactory(workflowRun)
				: null;

			const heartbeat = this.subscriberStrategy?.heartbeat;
			if (meta && heartbeat) {
				heartbeatInterval = setInterval(() => {
					try {
						heartbeat(workflowRun.id as WorkflowRunId, meta);
					} catch (error) {
						workflowLogger.warn("Failed to send heartbeat", {
							"aiki.error": error instanceof Error ? error.message : String(error),
						});
					}
				}, this.params.workflowRun?.heartbeatIntervalMs ?? 30_000);
			}

			await workflowVersion._internal.exec(
				this.client,
				workflowRun.input,
				{
					...workflowRun,
					handle: workflowRunHandle,
					logger: workflowLogger,
				},
				appContext,
			);

			workflowSucceeded = true;
			workflowLogger.info("Workflow execution completed");
		} catch (error) {
			workflowLogger.error("Workflow execution failed", {
				"aiki.error": error instanceof Error ? error.message : String(error),
				"aiki.stack": error instanceof Error ? error.stack : undefined,
			});
		} finally {
			if (heartbeatInterval) clearInterval(heartbeatInterval);

			if (meta && this.subscriberStrategy?.acknowledge) {
				if (workflowSucceeded) {
					try {
						await this.subscriberStrategy.acknowledge(workflowRun.id as WorkflowRunId, meta);
						workflowLogger.info("Message acknowledged");
					} catch (error) {
						workflowLogger.error("Failed to acknowledge message, it may be reprocessed", {
							"aiki.errorType": "MESSAGE_ACK_FAILED",
							"aiki.error": error instanceof Error ? error.message : String(error),
						});
					}
				} else {
					workflowLogger.debug("Message left in PEL for retry");
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
