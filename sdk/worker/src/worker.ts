import { httpSubscriber } from "@aikirun/http";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import { createBinaryLatch, delay } from "@aikirun/lib/async";
import type { Logger } from "@aikirun/lib/logger";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type { CreateSubscriber, Subscriber, WorkflowRunMessage } from "@aikirun/types/infra/queue";
import type { WorkerId } from "@aikirun/types/worker";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	type AnyWorkflowVersion,
	executeWorkflowRun,
	getSystemWorkflows,
	type WorkflowExecutionOptions,
	type WorkflowRegistry,
	type WorkflowVersion,
	workflowRegistry,
} from "@aikirun/workflow";
import { ulid } from "ulidx";

/**
 * Creates an Aiki worker definition for executing workflows.
 *
 * Worker definitions are static and reusable. Call `spawn(client)` to begin
 * execution, which returns a handle for controlling the running worker.
 *
 * @param params - Worker configuration parameters
 * @param params.workflows - Array of workflow versions this worker can execute
 * @param params.subscriber - Optional subscriber factory for work discovery (default: DB polling)
 * @returns Worker definition, call spawn(client) to begin execution
 *
 * @example
 * ```typescript
 * export const myWorker = worker({
 *   workflows: [orderWorkflowV1, paymentWorkflowV1],
 *   options: {
 *     maxConcurrentWorkflowRuns: 10,
 *   },
 * });
 *
 * const handle = await myWorker.spawn(client);
 *
 * process.on("SIGINT", async () => {
 *   await handle.stop();
 * });
 * ```
 */
export function worker(params: WorkerParams): Worker {
	return new WorkerImpl(params);
}

export interface WorkerParams {
	workflows: AnyWorkflowVersion[];
	subscriber?: CreateSubscriber;
	options?: WorkerDefinitionOptions;
}

export interface WorkerDefinitionOptions {
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: WorkflowExecutionOptions;
	gracefulShutdownTimeoutMs?: number;
}

export interface WorkerSpawnOptions extends WorkerDefinitionOptions {
	/**
	 * Optional array of shards this worker should process.
	 * When provided, the worker will only subscribe to registered workflows within that shard.
	 * When omitted, the worker subscribes to unsharded registered workflows.
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

export interface Worker {
	with(): WorkerBuilder;
	spawn: <AppContext>(client: Client<AppContext>) => Promise<WorkerHandle>;
}

export interface WorkerHandle {
	id: WorkerId;
	stop: () => Promise<void>;
}

class WorkerImpl implements Worker {
	constructor(private readonly params: WorkerParams) {}

	public with(): WorkerBuilder {
		const spawnOptions: WorkerSpawnOptions = this.params.options ?? {};
		const spawnOptionsOverrider = objectOverrider(spawnOptions);
		return new WorkerBuilderImpl(this, spawnOptionsOverrider());
	}

	public async spawn<AppContext>(client: Client<AppContext>): Promise<WorkerHandle> {
		return this.spawnWithOptions(client, this.params.options ?? {});
	}

	public async spawnWithOptions<AppContext>(
		client: Client<AppContext>,
		spawnOptions: WorkerSpawnOptions
	): Promise<WorkerHandle> {
		const handle = new WorkerHandleImpl(client, this.params, spawnOptions);
		await handle._start();
		return handle;
	}
}

interface ActiveWorkflowRun {
	run: WorkflowRun;
	executionPromise: Promise<void>;
}

class WorkerHandleImpl<AppContext> implements WorkerHandle {
	public readonly id: WorkerId;
	private readonly workflowRunOptions: Required<WorkflowExecutionOptions>;
	private readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private primarySubscriber: Subscriber | undefined;
	private backupSubscriber: Subscriber | undefined;
	private subscriberLoopPromise: Promise<void> | undefined;
	private primarySubscriberFailedAttempts = 0;
	private primarySubscriberNextAttemptAt = 0;
	private backupSubscriberFailedAttempts = 0;
	private availableCapacityLatch = createBinaryLatch();
	private pendingWorkflowRunIds = new Set<string>();
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();
	private lastServerHeartbeatByRunId = new Map<string, number>();
	private stopPromise: Promise<void> | undefined;

	constructor(
		private readonly client: Client<AppContext>,
		private readonly params: Omit<WorkerParams, "options">,
		private readonly spawnOptions: WorkerSpawnOptions
	) {
		this.id = ulid() as WorkerId;
		this.workflowRunOptions = {
			heartbeatIntervalMs: this.spawnOptions.workflowRun?.heartbeatIntervalMs ?? 30_000,
			spinThresholdMs: this.spawnOptions.workflowRun?.spinThresholdMs ?? 10,
		};
		this.registry = workflowRegistry().addMany(getSystemWorkflows(client.api)).addMany(this.params.workflows);

		const reference = this.spawnOptions.reference;
		this.logger = client.logger.child({
			"aiki.component": "worker",
			"aiki.workerId": this.id,
			...(reference && { "aiki.workerReferenceId": reference.id }),
		});
	}

	async _start(): Promise<void> {
		const workflows = this.registry.getAll();
		if (!isNonEmptyArray(workflows)) {
			throw new Error("No workflow registered");
		}

		const createPrimarySubscriber = this.params.subscriber ?? httpSubscriber({ api: this.client.api });
		this.primarySubscriber = createPrimarySubscriber({
			workerId: this.id,
			workflows,
			shards: this.spawnOptions.shards,
			logger: this.logger.child({ "aiki.subscriber": "primary" }),
		});
		this.primarySubscriber.heartbeat = this.withServerHeartbeatForwarding(
			this.primarySubscriber.heartbeat?.bind(this.primarySubscriber)
		);

		if (!this.params.subscriber) {
			const createBackupSubscriber = httpSubscriber({ api: this.client.api });
			this.backupSubscriber = createBackupSubscriber({
				workerId: this.id,
				workflows,
				shards: this.spawnOptions.shards,
				logger: this.logger.child({ "aiki.subscriber": "backup" }),
			});
			this.backupSubscriber.heartbeat = this.withServerHeartbeatForwarding(
				this.backupSubscriber.heartbeat?.bind(this.backupSubscriber)
			);
		}

		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		this.subscriberLoopPromise = this.subscriberLoop(abortSignal).catch((error) => {
			if (!abortSignal.aborted) {
				this.logger.error("Unexpected error", {
					"aiki.error": error.message,
				});
			}
		});
	}

	public stop(): Promise<void> {
		if (!this.stopPromise) {
			this.stopPromise = this._stop();
		}
		return this.stopPromise;
	}

	private async _stop(): Promise<void> {
		this.logger.info("Worker stopping");

		this.abortController?.abort();
		this.availableCapacityLatch.signal();

		await Promise.all([this.primarySubscriber?.close?.(), this.backupSubscriber?.close?.()]);

		await this.subscriberLoopPromise;

		const activeWorkflowRuns = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRuns.length > 0) {
			const timeoutMs = this.spawnOptions.gracefulShutdownTimeoutMs ?? 5_000;
			if (timeoutMs > 0) {
				await Promise.race([Promise.allSettled(activeWorkflowRuns.map((w) => w.executionPromise)), delay(timeoutMs)]);
			}

			const stillActiveRuns = Array.from(this.activeWorkflowRunsById.values());
			if (stillActiveRuns.length > 0) {
				const ids = stillActiveRuns.map((w) => w.run.id).join(", ");
				this.logger.warn("Worker shutdown with active workflows", {
					"aiki.activeWorkflowRunIds": ids,
				});
			}
		}

		this.pendingWorkflowRunIds.clear();
		this.activeWorkflowRunsById.clear();
		this.lastServerHeartbeatByRunId.clear();
	}

	private withServerHeartbeatForwarding(heartbeat?: (workflowRunId: WorkflowRunId) => Promise<void>) {
		const serverHeartbeatIntervalMs = 30_000;

		return async (workflowRunId: WorkflowRunId) => {
			if (heartbeat) {
				await heartbeat(workflowRunId);
			}

			const now = Date.now();
			const lastServerHeartbeat = this.lastServerHeartbeatByRunId.get(workflowRunId) ?? 0;
			if (now - lastServerHeartbeat >= serverHeartbeatIntervalMs) {
				this.lastServerHeartbeatByRunId.set(workflowRunId, now);
				await this.client.api.workflowRun.heartbeatV1({ id: workflowRunId });
			}
		};
	}

	private async subscriberLoop(abortSignal: AbortSignal): Promise<void> {
		if (!this.primarySubscriber) {
			throw new Error("Subscriber not initialized");
		}

		this.logger.info("Worker started", {
			"aiki.registeredWorkflows": this.params.workflows.map((w) => `${w.name}:${w.versionId}`),
		});

		const maxConcurrentWorkflowRuns = this.spawnOptions.maxConcurrentWorkflowRuns ?? 1;

		let activeSubscriber: Subscriber = this.primarySubscriber;
		let nextDelayMs = activeSubscriber.getNextDelay({ type: "no_work" });

		while (!abortSignal.aborted) {
			if (nextDelayMs > 0) {
				await delay(nextDelayMs, { abortSignal });
			}

			const availableCapacity =
				maxConcurrentWorkflowRuns - this.pendingWorkflowRunIds.size - this.activeWorkflowRunsById.size;
			if (availableCapacity <= 0) {
				await this.availableCapacityLatch.wait();
				continue;
			}

			const nextBatchResponse = await this.fetchNextWorkflowRunBatch(availableCapacity, abortSignal);
			if (!nextBatchResponse.success) {
				nextDelayMs = nextBatchResponse.retryDelayMs;
				continue;
			}

			activeSubscriber = nextBatchResponse.activeSubscriber;

			const workflowRunIdsToEnqueue: WorkflowRunId[] = [];
			for (const { data } of nextBatchResponse.batch) {
				const { id: workflowRunId } = data;
				if (!this.pendingWorkflowRunIds.has(workflowRunId) && !this.activeWorkflowRunsById.has(workflowRunId)) {
					this.pendingWorkflowRunIds.add(workflowRunId);
					workflowRunIdsToEnqueue.push(workflowRunId);
				}
			}

			if (!isNonEmptyArray(workflowRunIdsToEnqueue)) {
				nextDelayMs = activeSubscriber.getNextDelay({ type: "no_work" });
				continue;
			}

			this.enqueueWorkflowRunBatch(workflowRunIdsToEnqueue, activeSubscriber, abortSignal);
			nextDelayMs = 0;
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
		abortSignal: AbortSignal
	): Promise<
		| { success: true; batch: WorkflowRunMessage[]; activeSubscriber: Subscriber }
		| { success: false; retryDelayMs: number }
	> {
		if (!this.primarySubscriber) {
			throw new Error("Subscriber not initialized");
		}

		if (Date.now() >= this.primarySubscriberNextAttemptAt) {
			try {
				const batch = await this.primarySubscriber.getReadyRuns(size, { abortSignal });
				this.primarySubscriberFailedAttempts = 0;
				this.backupSubscriberFailedAttempts = 0;
				this.primarySubscriberNextAttemptAt = 0;
				return { success: true, batch, activeSubscriber: this.primarySubscriber };
			} catch (error) {
				if (abortSignal.aborted) {
					return { success: false, retryDelayMs: 0 };
				}

				this.logger.error("Subscriber failed", {
					"aiki.subscriber": "primary",
					"aiki.error": error instanceof Error ? error.message : String(error),
				});

				this.primarySubscriberFailedAttempts++;
				const retryDelayMs = this.primarySubscriber.getNextDelay({
					type: "retry",
					attemptNumber: this.primarySubscriberFailedAttempts,
				});
				this.primarySubscriberNextAttemptAt = Date.now() + retryDelayMs;
			}
		}

		if (!this.backupSubscriber) {
			return {
				success: false,
				retryDelayMs: this.primarySubscriberNextAttemptAt - Date.now(),
			};
		}

		try {
			const batch = await this.backupSubscriber.getReadyRuns(size, { abortSignal });
			this.backupSubscriberFailedAttempts = 0;
			return { success: true, batch, activeSubscriber: this.backupSubscriber };
		} catch (error) {
			if (abortSignal.aborted) {
				return { success: false, retryDelayMs: 0 };
			}

			this.logger.error("Subscriber failed", {
				"aiki.subscriber": "backup",
				"aiki.error": error instanceof Error ? error.message : String(error),
			});

			this.backupSubscriberFailedAttempts++;

			return {
				success: false,
				retryDelayMs: this.backupSubscriber.getNextDelay({
					type: "retry",
					attemptNumber: this.backupSubscriberFailedAttempts,
				}),
			};
		}
	}

	private enqueueWorkflowRunBatch(
		workflowRunIds: NonEmptyArray<WorkflowRunId>,
		subscriber: Subscriber,
		abortSignal: AbortSignal
	): void {
		const enqueue = async () => {
			for (const workflowRunId of workflowRunIds) {
				if (abortSignal.aborted) {
					return;
				}

				// TODO: maybe load multiple workflows in one request
				let workflowRun: WorkflowRun | undefined;
				try {
					const response = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
					workflowRun = response.run;
				} catch (error) {
					this.logger.warn("Failed to fetch workflow run", {
						"aiki.workflowRunId": workflowRunId,
						"aiki.error": error instanceof Error ? error.message : String(error),
					});
					this.pendingWorkflowRunIds.delete(workflowRunId);
					this.availableCapacityLatch.signal();
					continue;
				}

				if (abortSignal.aborted) {
					return;
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
					this.pendingWorkflowRunIds.delete(workflowRunId);
					this.availableCapacityLatch.signal();
					continue;
				}

				this.pendingWorkflowRunIds.delete(workflowRunId);
				const workflowExecutionPromise = this.executeWorkflow(workflowRun, workflowVersion, subscriber, abortSignal);
				this.activeWorkflowRunsById.set(workflowRun.id, {
					run: workflowRun,
					executionPromise: workflowExecutionPromise,
				});
			}
		};

		enqueue().catch((error) => {
			if (!abortSignal.aborted) {
				this.logger.error("Error enqueuing workflow run batch", {
					"aiki.error": error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	private async executeWorkflow(
		workflowRun: WorkflowRun,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
		subscriber: Subscriber,
		abortSignal: AbortSignal
	): Promise<void> {
		const workflowRunId = workflowRun.id as WorkflowRunId;

		const logger = this.logger.child({
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRunId,
		});

		const { heartbeat } = subscriber;

		try {
			const success = await executeWorkflowRun({
				client: this.client,
				workflowRun,
				workflowVersion,
				logger,
				options: {
					spinThresholdMs: this.workflowRunOptions.spinThresholdMs,
					heartbeatIntervalMs: this.workflowRunOptions.heartbeatIntervalMs,
				},
				heartbeat: heartbeat ? () => heartbeat(workflowRunId) : undefined,
				abortSignal,
			});

			if (!abortSignal.aborted && subscriber.acknowledge) {
				if (success) {
					try {
						await subscriber.acknowledge(workflowRunId);
					} catch (error) {
						if (!abortSignal.aborted) {
							logger.error("Failed to acknowledge message, it may be reprocessed", {
								"aiki.errorType": "MESSAGE_ACK_FAILED",
								"aiki.error": error instanceof Error ? error.message : String(error),
							});
						}
					}
				} else {
					logger.debug("Message not acknowledged");
				}
			}
		} finally {
			this.activeWorkflowRunsById.delete(workflowRunId);
			this.lastServerHeartbeatByRunId.delete(workflowRunId);
			this.availableCapacityLatch.signal();
		}
	}
}

export interface WorkerBuilder {
	opt<Path extends PathFromObject<WorkerSpawnOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerSpawnOptions, Path>
	): WorkerBuilder;
	spawn: Worker["spawn"];
}

class WorkerBuilderImpl implements WorkerBuilder {
	constructor(
		private readonly worker: WorkerImpl,
		private readonly spawnOptionsBuilder: ObjectBuilder<WorkerSpawnOptions>
	) {}

	opt<Path extends PathFromObject<WorkerSpawnOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerSpawnOptions, Path>
	): WorkerBuilder {
		return new WorkerBuilderImpl(this.worker, this.spawnOptionsBuilder.with(path, value));
	}

	spawn<AppContext>(client: Client<AppContext>): Promise<WorkerHandle> {
		return this.worker.spawnWithOptions(client, this.spawnOptionsBuilder.build());
	}
}
