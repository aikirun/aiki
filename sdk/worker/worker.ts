import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/array";
import { delay } from "@aikirun/lib/async";
import { type ObjectBuilder, objectOverrider, type PathFromObject, type TypeOfValueAtPath } from "@aikirun/lib/object";
import { dbSubscriber } from "@aikirun/subscriber-db";
import type { Client } from "@aikirun/types/client";
import type { Logger } from "@aikirun/types/logger";
import type { CreateSubscriber, Subscriber, SubscriberContext, WorkflowRunBatch } from "@aikirun/types/subscriber";
import type { WorkerId } from "@aikirun/types/worker";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { WorkflowRun, WorkflowRunId } from "@aikirun/types/workflow-run";
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
 *   opts: {
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
	opts?: WorkerDefinitionOptions;
}

export interface WorkerDefinitionOptions {
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: WorkflowExecutionOptions;
	gracefulShutdownTimeoutMs?: number;
}

export interface WorkerSpawnOptions extends WorkerDefinitionOptions {
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
		const spawnOpts: WorkerSpawnOptions = this.params.opts ?? {};
		const spawnOptsOverrider = objectOverrider(spawnOpts);
		return new WorkerBuilderImpl(this, spawnOptsOverrider());
	}

	public async spawn<AppContext>(client: Client<AppContext>): Promise<WorkerHandle> {
		return this.spawnWithOpts(client, this.params.opts ?? {});
	}

	public async spawnWithOpts<AppContext>(
		client: Client<AppContext>,
		spawnOpts: WorkerSpawnOptions
	): Promise<WorkerHandle> {
		const handle = new WorkerHandleImpl(client, this.params, spawnOpts);
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
	private readonly workflowRunOpts: Required<WorkflowExecutionOptions>;
	private readonly registry: WorkflowRegistry;
	private readonly logger: Logger;
	private abortController: AbortController | undefined;
	private subscriber: Subscriber | undefined;
	private fallbackSubscriber: Subscriber | undefined;
	private pollPromise: Promise<void> | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		private readonly client: Client<AppContext>,
		private readonly params: Omit<WorkerParams, "opts">,
		private readonly spawnOpts: WorkerSpawnOptions
	) {
		this.id = ulid() as WorkerId;
		this.workflowRunOpts = {
			heartbeatIntervalMs: this.spawnOpts.workflowRun?.heartbeatIntervalMs ?? 30_000,
			spinThresholdMs: this.spawnOpts.workflowRun?.spinThresholdMs ?? 10,
		};
		this.registry = workflowRegistry().addMany(getSystemWorkflows(client.api)).addMany(this.params.workflows);

		const reference = this.spawnOpts.reference;
		this.logger = client.logger.child({
			"aiki.component": "worker",
			"aiki.workerId": this.id,
			...(reference && { "aiki.workerReferenceId": reference.id }),
		});
	}

	async _start(): Promise<void> {
		const subscriberContext: SubscriberContext = {
			workerId: this.id,
			workflows: this.registry.getAll(),
			shards: this.spawnOpts.shards,
			logger: this.logger,
		};

		const createSubscriber = this.params.subscriber ?? dbSubscriber({ api: this.client.api });
		const subscriber = createSubscriber(subscriberContext);
		this.subscriber = subscriber instanceof Promise ? await subscriber : subscriber;

		const createFallbackSubscriber = dbSubscriber({ api: this.client.api });
		const fallbackSubscriber = createFallbackSubscriber(subscriberContext);
		this.fallbackSubscriber = fallbackSubscriber instanceof Promise ? await fallbackSubscriber : fallbackSubscriber;

		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		this.pollPromise = this.poll(abortSignal).catch((error) => {
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

		await this.pollPromise;

		await this.subscriber?.close?.();
		await this.fallbackSubscriber?.close?.();

		const activeWorkflowRuns = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRuns.length === 0) {
			return;
		}

		const timeoutMs = this.spawnOpts.gracefulShutdownTimeoutMs ?? 5_000;
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
		if (!this.subscriber) {
			throw new Error("Subscriber not initialized");
		}

		this.logger.info("Worker started", {
			"aiki.registeredWorkflows": this.params.workflows.map((w) => `${w.name}:${w.versionId}`),
		});

		const maxConcurrentWorkflowRuns = this.spawnOpts.maxConcurrentWorkflowRuns ?? 1;

		let nextDelayMs = this.subscriber.getNextDelay({ type: "polled", foundWork: false });
		let subscriberFailedAttempts = 0;

		while (!abortSignal.aborted) {
			await delay(nextDelayMs, { abortSignal });

			const availableCapacity = maxConcurrentWorkflowRuns - this.activeWorkflowRunsById.size;
			if (availableCapacity <= 0) {
				nextDelayMs = this.subscriber.getNextDelay({ type: "at_capacity" });
				continue;
			}

			const nextBatchResponse = await this.fetchNextWorkflowRunBatch(availableCapacity, subscriberFailedAttempts);
			if (!nextBatchResponse.success) {
				subscriberFailedAttempts++;
				nextDelayMs = this.subscriber.getNextDelay({
					type: "retry",
					attemptNumber: subscriberFailedAttempts,
				});
				continue;
			}

			subscriberFailedAttempts = 0;

			if (!isNonEmptyArray(nextBatchResponse.batch)) {
				nextDelayMs = this.subscriber.getNextDelay({ type: "polled", foundWork: false });
				continue;
			}

			await this.enqueueWorkflowRunBatch(nextBatchResponse.batch, nextBatchResponse.subscriber, abortSignal);
			nextDelayMs = this.subscriber.getNextDelay({ type: "polled", foundWork: true });
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
		subscriberFailedAttempts: number
	): Promise<{ success: true; batch: WorkflowRunBatch[]; subscriber: Subscriber } | { success: false; error: Error }> {
		if (!this.subscriber) {
			return {
				success: false,
				error: new Error("Subscriber not initialized"),
			};
		}

		try {
			const batch = await this.subscriber.getNextBatch(size);
			return { success: true, batch, subscriber: this.subscriber };
		} catch (error) {
			this.logger.error("Error getting next workflow runs batch", {
				"aiki.error": error instanceof Error ? error.message : String(error),
			});

			if (this.fallbackSubscriber && subscriberFailedAttempts >= 2) {
				try {
					const batch = await this.fallbackSubscriber.getNextBatch(size);
					return { success: true, batch, subscriber: this.fallbackSubscriber };
				} catch (fallbackError) {
					this.logger.error("Fallback subscriber also failed to get next workflow runs batch", {
						"aiki.error": fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
					});
				}
			}

			return { success: false, error: error as Error };
		}
	}

	private async enqueueWorkflowRunBatch(
		batch: NonEmptyArray<WorkflowRunBatch>,
		subscriber: Subscriber,
		abortSignal: AbortSignal
	): Promise<void> {
		for (const { data } of batch) {
			const { workflowRunId } = data;
			if (this.activeWorkflowRunsById.has(workflowRunId)) {
				this.logger.info("Workflow already running", {
					"aiki.workflowRunId": workflowRunId,
				});
				continue;
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
				if (subscriber.acknowledge) {
					await subscriber.acknowledge(workflowRunId).catch(() => {});
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
				if (subscriber.acknowledge) {
					await subscriber.acknowledge(workflowRunId).catch(() => {});
				}
				continue;
			}

			if (abortSignal.aborted) {
				break;
			}

			const workflowExecutionPromise = this.executeWorkflow(workflowRun, workflowVersion, subscriber);

			this.activeWorkflowRunsById.set(workflowRun.id, {
				run: workflowRun,
				executionPromise: workflowExecutionPromise,
			});
		}
	}

	private async executeWorkflow(
		workflowRun: WorkflowRun,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
		subscriber: Subscriber
	): Promise<void> {
		const logger = this.logger.child({
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
		});

		const heartbeat = subscriber.heartbeat;

		const success = await executeWorkflowRun({
			client: this.client,
			workflowRun,
			workflowVersion,
			logger,
			options: {
				spinThresholdMs: this.workflowRunOpts.spinThresholdMs,
				heartbeatIntervalMs: this.workflowRunOpts.heartbeatIntervalMs,
			},
			heartbeat: heartbeat ? () => heartbeat(workflowRun.id as WorkflowRunId) : undefined,
		});

		if (subscriber.acknowledge) {
			if (success) {
				try {
					await subscriber.acknowledge(workflowRun.id as WorkflowRunId);
				} catch (error) {
					logger.error("Failed to acknowledge message, it may be reprocessed", {
						"aiki.errorType": "MESSAGE_ACK_FAILED",
						"aiki.error": error instanceof Error ? error.message : String(error),
					});
				}
			} else {
				logger.debug("Message left pending for retry");
			}
		}

		this.activeWorkflowRunsById.delete(workflowRun.id);
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
		private readonly spawnOptsBuilder: ObjectBuilder<WorkerSpawnOptions>
	) {}

	opt<Path extends PathFromObject<WorkerSpawnOptions>>(
		path: Path,
		value: TypeOfValueAtPath<WorkerSpawnOptions, Path>
	): WorkerBuilder {
		return new WorkerBuilderImpl(this.worker, this.spawnOptsBuilder.with(path, value));
	}

	spawn<AppContext>(client: Client<AppContext>): Promise<WorkerHandle> {
		return this.worker.spawnWithOpts(client, this.spawnOptsBuilder.build());
	}
}
