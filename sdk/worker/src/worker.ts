import { httpSubscriber } from "@aikirun/http";
import { createBinaryLatch, delay, settleWithin } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import { asConfigProvider, type ConfigProvider, type CreateConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import {
	merge,
	type ObjectBuilder,
	objectOverrider,
	type PathFromObject,
	type TypeOfValueAtPath,
} from "@aikirun/lib/object";
import type { Client } from "@aikirun/types/client";
import type { CreateSubscriber, Subscriber, WorkflowRunMessage } from "@aikirun/types/infra/queue";
import type { WorkerId } from "@aikirun/types/worker";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	type AnyWorkflowVersion,
	executeWorkflowRun,
	getSystemWorkflows,
	type WorkflowRegistry,
	type WorkflowVersion,
	workflowRegistry,
} from "@aikirun/workflow";
import { ulid } from "ulidx";

import { defaultWorkerConfig, type WorkerConfig, type WorkerConfigOverrides } from "./config";

/**
 * Creates an Aiki worker definition for executing workflows.
 *
 * Worker definitions are static and reusable. Call `start(client)` to begin
 * execution, which returns a handle for controlling the running worker.
 *
 * @param params - Worker configuration parameters
 * @param params.workflows - Array of workflow versions this worker can execute
 * @param params.subscriber - Optional subscriber factory for work discovery (default: claims work from the server over HTTP)
 * @param params.config - Optional runtime tunables: a plain overrides object, or a config provider (e.g. `dynamicWorkerConfigProvider`) for live reloads
 * @returns Worker definition, call start(client) to begin execution
 *
 * @example
 * ```typescript
 * export const myWorker = worker({
 *   workflows: [orderWorkflowV1, paymentWorkflowV1],
 *   config: { maxConcurrentWorkflowRuns: 10 },
 * });
 *
 * const handle = myWorker.start(client);
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
	config?: WorkerConfigOverrides | CreateConfigProvider<WorkerConfig>;
}

export interface WorkerStartOptions {
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
	start: <Context>(client: Client<Context>) => WorkerHandle;
}

export interface WorkerHandle {
	id: WorkerId;
	stop: () => Promise<void>;
}

class WorkerImpl implements Worker {
	constructor(private readonly params: WorkerParams) {}

	public with(): WorkerBuilder {
		const startOptionsOverrider = objectOverrider<WorkerStartOptions>({});
		return createWorkerBuilder(this, startOptionsOverrider());
	}

	public start<Context>(client: Client<Context>): WorkerHandle {
		return this.startWithOptions(client, {});
	}

	public startWithOptions<Context>(client: Client<Context>, startOptions: WorkerStartOptions): WorkerHandle {
		return new WorkerHandleImpl(client, this.params, startOptions);
	}
}

interface ActiveWorkflowRun {
	run: WorkflowRunRecord;
	executionPromise: Promise<void>;
}

class WorkerHandleImpl<Context> implements WorkerHandle {
	public readonly id: WorkerId;
	private readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private readonly abortController: AbortController;
	private readonly configProvider: ConfigProvider<WorkerConfig>;
	private readonly primarySubscriber: Subscriber;
	private readonly backupSubscriber: Subscriber | undefined;
	private readonly subscriberLoopPromise: Promise<void>;
	private primarySubscriberFailedAttempts = 0;
	private primarySubscriberNextAttemptAt = 0;
	private backupSubscriberFailedAttempts = 0;
	private readonly availableCapacityLatch = createBinaryLatch();
	private readonly pendingWorkflowRunIds = new Set<string>();
	private readonly activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();
	private stopPromise: Promise<void> | undefined;

	constructor(
		private readonly client: Client<Context>,
		private readonly params: WorkerParams,
		private readonly startOptions: WorkerStartOptions
	) {
		this.id = ulid() as WorkerId;
		this.registry = workflowRegistry().addMany(getSystemWorkflows(this.client.api)).addMany(this.params.workflows);
		const workflows = this.registry.getAll();
		if (!isNonEmptyArray(workflows)) {
			throw new Error("No workflow registered");
		}

		const reference = this.startOptions.reference;
		this.logger = this.client.logger.child({
			"aiki.component": "worker",
			"aiki.workerId": this.id,
			...(reference && { "aiki.workerReferenceId": reference.id }),
		});

		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		const configParam = this.params.config;
		let configProvider: ConfigProvider<WorkerConfig>;
		if (typeof configParam === "function") {
			configProvider = configParam({ logger: this.logger.child({ "aiki.component": "config-provider" }), signal });
		} else {
			const config = merge(defaultWorkerConfig, configParam);
			configProvider = asConfigProvider(() => config);
		}
		this.configProvider = configProvider;

		const createPrimarySubscriber = this.params.subscriber ?? httpSubscriber({ api: this.client.api });
		this.primarySubscriber = createPrimarySubscriber({
			workerId: this.id,
			workflows,
			shards: this.startOptions.shards,
			logger: this.logger.child({ "aiki.subscriber": "primary" }),
			signal,
		});

		// Backup subscriber is only created if the user provided a custom subscriber.
		// When the custom subscriber is present, we know for sure that it is not httpSubscriber
		// because that pacakge is private
		if (this.params.subscriber) {
			const createBackupSubscriber = httpSubscriber({ api: this.client.api });
			this.backupSubscriber = createBackupSubscriber({
				workerId: this.id,
				workflows,
				shards: this.startOptions.shards,
				logger: this.logger.child({ "aiki.subscriber": "backup" }),
				signal,
			});
		}

		this.subscriberLoopPromise = this.subscriberLoop(signal).catch((error) => {
			if (!signal.aborted) {
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

		this.abortController.abort();
		this.availableCapacityLatch.signal();

		await this.subscriberLoopPromise;

		const activeWorkflowRuns = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRuns.length > 0) {
			const gracefulShutdownTimeoutMs = this.configProvider.config.gracefulShutdownTimeoutMs;
			if (gracefulShutdownTimeoutMs > 0) {
				await settleWithin(
					Promise.allSettled(activeWorkflowRuns.map((w) => w.executionPromise)),
					gracefulShutdownTimeoutMs
				);
			}

			const stillActiveRuns = Array.from(this.activeWorkflowRunsById.values());
			if (stillActiveRuns.length > 0) {
				const ids = stillActiveRuns.map((w) => w.run.id).join(", ");
				this.logger.warn("Worker stopped while some workflows were active", {
					"aiki.activeWorkflowRunIds": ids,
				});
			}
		}

		this.pendingWorkflowRunIds.clear();
		this.activeWorkflowRunsById.clear();
	}

	private async subscriberLoop(signal: AbortSignal): Promise<void> {
		this.logger.info("Worker started", {
			"aiki.registeredWorkflows": this.params.workflows.map((w) => `${w.name}:${w.versionId}`),
		});

		let activeSubscriber: Subscriber = this.primarySubscriber;
		let nextDelayMs = activeSubscriber.getNextDelay({ type: "no_work" });

		while (!signal.aborted) {
			if (nextDelayMs > 0) {
				await delay(nextDelayMs, { signal });
			}

			const maxConcurrentWorkflowRuns = this.configProvider.config.maxConcurrentWorkflowRuns;
			const availableCapacity =
				maxConcurrentWorkflowRuns - this.pendingWorkflowRunIds.size - this.activeWorkflowRunsById.size;
			if (availableCapacity <= 0) {
				await this.availableCapacityLatch.wait();
				nextDelayMs = 0;
				continue;
			}

			const nextBatchResponse = await this.fetchNextWorkflowRunBatch(availableCapacity, signal);
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

			this.enqueueWorkflowRunBatch(workflowRunIdsToEnqueue, activeSubscriber, signal);
			nextDelayMs = 0;
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
		signal: AbortSignal
	): Promise<
		| { success: true; batch: WorkflowRunMessage[]; activeSubscriber: Subscriber }
		| { success: false; retryDelayMs: number }
	> {
		if (Date.now() >= this.primarySubscriberNextAttemptAt) {
			try {
				const batch = await this.primarySubscriber.getReadyRuns(size);
				this.primarySubscriberFailedAttempts = 0;
				this.backupSubscriberFailedAttempts = 0;
				this.primarySubscriberNextAttemptAt = 0;
				return { success: true, batch, activeSubscriber: this.primarySubscriber };
			} catch (err) {
				if (signal.aborted) {
					return { success: false, retryDelayMs: 0 };
				}

				this.logger.error("Subscriber failed", {
					"aiki.subscriber": "primary",
					"aiki.error": err instanceof Error ? err.message : String(err),
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
			const batch = await this.backupSubscriber.getReadyRuns(size);
			this.backupSubscriberFailedAttempts = 0;
			return { success: true, batch, activeSubscriber: this.backupSubscriber };
		} catch (err) {
			if (signal.aborted) {
				return { success: false, retryDelayMs: 0 };
			}

			this.logger.error("Subscriber failed", {
				"aiki.subscriber": "backup",
				"aiki.error": err instanceof Error ? err.message : String(err),
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
		signal: AbortSignal
	): void {
		const enqueue = async () => {
			for (const workflowRunId of workflowRunIds) {
				if (signal.aborted) {
					return;
				}

				// TODO: maybe load multiple workflows in one request
				let workflowRun: WorkflowRunRecord | undefined;
				try {
					const response = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
					workflowRun = response.run;
				} catch (err) {
					this.logger.warn("Failed to fetch workflow run", {
						"aiki.workflowRunId": workflowRunId,
						"aiki.error": err instanceof Error ? err.message : String(err),
					});
					this.pendingWorkflowRunIds.delete(workflowRunId);
					this.availableCapacityLatch.signal();
					continue;
				}

				if (signal.aborted) {
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
				const workflowExecutionPromise = this.executeWorkflow(workflowRun, workflowVersion, subscriber, signal);
				this.activeWorkflowRunsById.set(workflowRun.id, {
					run: workflowRun,
					executionPromise: workflowExecutionPromise,
				});
			}
		};

		enqueue().catch((error) => {
			if (!signal.aborted) {
				this.logger.error("Error enqueuing workflow run batch", {
					"aiki.error": error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	private async executeWorkflow(
		workflowRun: WorkflowRunRecord,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
		subscriber: Subscriber,
		signal: AbortSignal
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
				configProvider: this.configProvider.scope("workflowRun"),
				heartbeat: heartbeat
					? { send: () => heartbeat.send(workflowRunId), intervalMs: heartbeat.intervalMs }
					: undefined,
				signal,
			});

			if (!signal.aborted && subscriber.acknowledge) {
				if (success) {
					try {
						await subscriber.acknowledge(workflowRunId);
					} catch (err) {
						if (!signal.aborted) {
							logger.error("Failed to acknowledge message, it may be reprocessed", {
								"aiki.errorType": "MESSAGE_ACK_FAILED",
								"aiki.error": err instanceof Error ? err.message : String(err),
							});
						}
					}
				} else {
					logger.debug("Message not acknowledged");
				}
			}
		} finally {
			this.activeWorkflowRunsById.delete(workflowRunId);
			this.availableCapacityLatch.signal();
		}
	}
}

export interface WorkerBuilder {
	opt<Path extends PathFromObject<WorkerStartOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerStartOptions, Path>
	): WorkerBuilder;
	start: Worker["start"];
}

function createWorkerBuilder(
	worker: WorkerImpl,
	startOptionsBuilder: ObjectBuilder<WorkerStartOptions>
): WorkerBuilder {
	return {
		opt(path, value) {
			return createWorkerBuilder(worker, startOptionsBuilder.with(path, value));
		},

		start(client) {
			return worker.startWithOptions(client, startOptionsBuilder.build());
		},
	};
}
