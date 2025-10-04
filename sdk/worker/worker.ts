import type { WorkflowName, WorkflowRunId, WorkflowRunRow, WorkflowVersionId } from "@aiki/types/workflow";
import { isNonEmptyArray } from "@aiki/lib/array";
import type { NonEmptyArray } from "@aiki/lib/array";
import { delay } from "@aiki/lib/async";
import type { Client, SubscriberStrategy } from "../client/mod.ts";
import type { ResolvedSubscriberStrategy, SubscriberStrategyBuilder } from "../client/subscribers/strategy-resolver.ts";
import type { WorkflowVersion } from "../workflow/version/workflow-version.ts";
import { initWorkflowRegistry, type WorkflowRegistry } from "../workflow/registry.ts";
import { initWorkflowRun } from "../workflow/run/workflow-run.ts";

export function worker(
	client: Client,
	params: WorkerParams,
): Promise<Worker> {
	const workflowRegistry = initWorkflowRegistry();
	const subscriberStrategyBuilder = client._internal.subscriber.create(
		params.subscriber ?? { type: "polling" },
		workflowRegistry._internal.getNames(),
		params.shards,
	);
	return Promise.resolve(
		new WorkerImpl(
			client,
			workflowRegistry,
			subscriberStrategyBuilder,
			params,
		),
	);
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
	 * Optional array of shard keys this worker should process.
	 * When provided, the worker will only subscribe to sharded streams: workflow:${workflowName}:${shard}
	 * When omitted, the worker subscribes to default streams: workflow:${workflowName}
	 * Cannot be combined with non-sharded workflows in the same worker instance.
	 */
	shards?: string[];
}

export interface Worker {
	id: string;
	workflowRegistry: WorkflowRegistry;
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

interface ActiveWorkflowRun {
	run: WorkflowRunRow<unknown, unknown>;
	executionPromise: Promise<void>;
}

class WorkerImpl implements Worker {
	public readonly id: string;
	private abortController: AbortController | undefined;
	private subscriberStrategy: ResolvedSubscriberStrategy | undefined;
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		private readonly client: Client,
		public readonly workflowRegistry: WorkflowRegistry,
		private readonly subscriberStrategyBuilder: SubscriberStrategyBuilder,
		private readonly params: WorkerParams,
	) {
		this.id = params.id ?? crypto.randomUUID();
	}

	public async start(): Promise<void> {
		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		this.subscriberStrategy = await this.subscriberStrategyBuilder.init(this.id, {
			onError: (error: Error) => this.handleNotificationError(error),
			onStop: () => this.stop(),
		});

		await this.startPolling(abortSignal);
	}

	public async stop(): Promise<void> {
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
				// deno-lint-ignore no-console
				console.warn("Error during graceful shutdown", error);
			}
		}

		const activeWorkflowRunsOnShutdown = Array.from(this.activeWorkflowRunsById.values());
		if (activeWorkflowRunsOnShutdown.length > 0) {
			const ids = activeWorkflowRunsOnShutdown.map((w) => w.run.id).join(", ");
			// deno-lint-ignore no-console
			console.warn(`Worker ${this.id} shutdown while workflows ${ids} still running`);
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
			// deno-lint-ignore no-console
			console.error(`Worker ${this.id}: Error getting next workflow runs batch`, error);

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

			// Fetch the full workflow run row by ID
			const workflowRunRow = await this.client.api.workflowRun.getByIdV1.query({ id: workflowRunId });
			if (!workflowRunRow) {
				// Debug: Workflow run not found in repository
				continue;
			}

			const workflow = this.workflowRegistry._internal.getByName(workflowRunRow.name as WorkflowName);
			if (!workflow) {
				// Debug: No registered workflow for name
				continue;
			}

			const workflowVersion = workflow._internal.getVersion(workflowRunRow.versionId as WorkflowVersionId);
			if (!workflowVersion) {
				// Debug: No registered version for workflow
				continue;
			}

			if (abortSignal.aborted) break;

			const workflowExecutionPromise = this.executeWorkflow(
				workflowRunRow as WorkflowRunRow<unknown, unknown>,
				workflowVersion,
			);

			this.activeWorkflowRunsById.set(workflowRunRow.id, {
				run: workflowRunRow as WorkflowRunRow<unknown, unknown>,
				executionPromise: workflowExecutionPromise,
			});
		}
	}

	private async executeWorkflow(
		workflowRunRow: WorkflowRunRow<unknown, unknown>,
		workflowVersion: WorkflowVersion<unknown, unknown>,
	): Promise<void> {
		let heartbeatInterval: number | undefined;
		try {
			const workflowRun = await initWorkflowRun(this.client.api, workflowRunRow);

			heartbeatInterval = setInterval(() => {
				try {
					// TODO: update heart beat via redis stream
				} catch (error) {
					// deno-lint-ignore no-console
					console.warn(`Worker ${this.id}: Failed to update workflow heartbeat ${workflowRun.id}`, error);
				}
			}, this.params.workflowRun?.heartbeatIntervalMs ?? 30_000);

			await workflowVersion._execute({ workflowRun }, workflowRunRow.params.payload);
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Worker ${this.id}: Error processing workflow: ${workflowRunRow.id}`, error);
		} finally {
			if (heartbeatInterval) clearInterval(heartbeatInterval);
			this.activeWorkflowRunsById.delete(workflowRunRow.id);
		}
	}

	private handleNotificationError(error: Error): void {
		// deno-lint-ignore no-console
		console.warn(`Worker ${this.id}: Notification error:`, error);

		const fallbackEnabled = true; // Fallback is always enabled

		if (fallbackEnabled) {
			// Debug: Fallback to polling due to error
		}
	}
}
