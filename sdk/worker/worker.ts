import type { WorkflowRunId, WorkflowRun } from "@aiki/contract/workflow-run";
import { isNonEmptyArray } from "@aiki/lib/array";
import type { NonEmptyArray } from "@aiki/lib/array";
import { delay } from "@aiki/lib/async";
import type { Client, SubscriberStrategy } from "../client/mod.ts";
import type { ResolvedSubscriberStrategy } from "../client/subscribers/strategy-resolver.ts";
import { initWorkflowRegistry, type WorkflowRegistry } from "../workflow/registry.ts";
import { initWorkflowRunHandle } from "../workflow/run/run-handle.ts";
import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { WorkflowVersion } from "../workflow/version/workflow-version.ts";
import { getChildLogger, type Logger } from "../logger/mod.ts";

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
	// TODO: this should not return a promise
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

interface ActiveWorkflowRun {
	run: WorkflowRun<unknown, unknown>;
	executionPromise: Promise<void>;
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

	public async start(): Promise<void> {
		this.logger.info("Worker starting");

		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		const subscriberStrategyBuilder = this.client._internal.subscriber.create(
			this.params.subscriber ?? { type: "polling" },
			this.workflowRegistry._internal.getAll().map((workflow) => workflow.name),
			this.params.shardKeys,
		);

		this.subscriberStrategy = await subscriberStrategyBuilder.init(this.id, {
			onError: (error: Error) => this.handleNotificationError(error),
			onStop: () => this.stop(),
		});

		await this.startPolling(abortSignal);
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
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const activeWorkflowRunsOnShutdown = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRunsOnShutdown.length > 0) {
			const ids = activeWorkflowRunsOnShutdown.map((w) => w.run.id).join(", ");
			this.logger.warn("Worker shutdown with active workflows", {
				activeWorkflowRunIds: ids,
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

			if (!isNonEmptyArray(nextBatchResult.ids)) {
				nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: false });
				continue;
			}

			await this.enqueueWorkflowRunBatch(nextBatchResult.ids, abortSignal);
			nextDelayMs = this.subscriberStrategy.getNextDelay({ type: "polled", foundWork: true });
		}
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
	): Promise<
		| { success: true; ids: WorkflowRunId[] }
		| { success: false; error: Error }
	> {
		if (!this.subscriberStrategy) {
			return {
				success: false,
				error: new Error("Subscriber strategy not initialized"),
			};
		}

		try {
			const workflowRunIds = await this.subscriberStrategy.getNextBatch(size);
			return {
				success: true,
				ids: workflowRunIds,
			};
		} catch (error) {
			this.logger.error("Error getting next workflow runs batch", {
				error: error instanceof Error ? error.message : String(error),
			});

			return {
				success: false,
				error: error as Error,
			};
		}
	}

	private async enqueueWorkflowRunBatch(
		workflowRunIds: NonEmptyArray<WorkflowRunId>,
		abortSignal: AbortSignal,
	): Promise<void> {
		for (const workflowRunId of workflowRunIds) {
			if (this.activeWorkflowRunsById.has(workflowRunId)) {
				// Debug: Skip already in progress workflows
				continue;
			}

			const { run: workflowRun } = await this.client.api.workflowRun.getByIdV1({ id: workflowRunId });
			if (!workflowRun) {
				// Debug: Workflow run not found in repository
				continue;
			}

			const workflow = this.workflowRegistry._internal.get(workflowRun.name as WorkflowName);
			if (!workflow) {
				this.logger.warn("Workflow not found in registry", {
					workflowName: workflowRun.name,
					workflowRunId: workflowRun.id,
				});
				continue;
			}

			const workflowVersion = workflow._internal.getVersion(workflowRun.versionId as WorkflowVersionId);
			if (!workflowVersion) {
				this.logger.warn("Workflow version not found", {
					workflowName: workflowRun.name,
					workflowVersionId: workflowRun.versionId,
					workflowRunId: workflowRun.id,
				});
				continue;
			}

			if (abortSignal.aborted) break;

			const workflowExecutionPromise = this.executeWorkflow(workflowRun, workflowVersion);

			this.activeWorkflowRunsById.set(workflowRun.id, {
				run: workflowRun,
				executionPromise: workflowExecutionPromise,
			});
		}
	}

	private async executeWorkflow(
		workflowRun: WorkflowRun<unknown, unknown>,
		workflowVersion: WorkflowVersion<unknown, unknown, unknown>,
	): Promise<void> {
		const workflowLogger = getChildLogger(this.logger, {
			"aiki.component": "workflow-execution",
			"aiki.workflowName": workflowRun.name,
			"aiki.workflowVersionId": workflowRun.versionId,
			"aiki.workflowRunId": workflowRun.id,
		});

		workflowLogger.info("Executing workflow");

		let heartbeatInterval: number | undefined;
		try {
			const workflowRunHandle = initWorkflowRunHandle(this.client.api, workflowRun);

			const appContext = this.client._internal.contextFactory
				? await this.client._internal.contextFactory(workflowRun)
				: null;

			heartbeatInterval = setInterval(() => {
				try {
					// TODO: update heart beat via redis stream
				} catch (error) {
					workflowLogger.warn("Failed to update workflow heartbeat", {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}, this.params.workflowRun?.heartbeatIntervalMs ?? 30_000);

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

			workflowLogger.info("Workflow execution completed");
		} catch (error) {
			workflowLogger.error("Workflow execution failed", {
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
		} finally {
			if (heartbeatInterval) clearInterval(heartbeatInterval);
			this.activeWorkflowRunsById.delete(workflowRun.id);
		}
	}

	private handleNotificationError(error: Error): void {
		this.logger.warn("Notification error, falling back to polling", {
			error: error.message,
			stack: error.stack,
		});

		// TODO: remove
		const fallbackEnabled = true; // Fallback is always enabled

		if (fallbackEnabled) {
			this.logger.debug("Fallback to polling enabled");
		}
	}
}
