import type { Client } from "../client/definition.ts";
import { initWorkflowRegistry, type WorkflowRegistry } from "../workflow/registry.ts";
import type { WorkflowRunSubscriber } from "../workflow/run/subscriber.ts";
import { initWorkflowRun } from "../workflow/run/definition.ts";
import type { WorkflowRunRepository, WorkflowRunRow } from "../workflow/run/repository.ts";
import { getRetryParams, type RetryParams } from "@lib/retry/mod.ts";
import { isNonEmptyArray } from "@lib/array/mod.ts";
import type { NonEmptyArray } from "@lib/array/mod.ts";
import type { Workflow } from "../workflow/definition.ts";
import { delay } from "@lib/async/mod.ts";
import { CrossPlatformProcess } from "@lib/process/mod.ts";

export async function worker(
	client: Client,
	params: WorkerParams,
): Promise<Worker> {
	const registry = initWorkflowRegistry();
	const workflowRunSubscriber = await client.getWorkflowRunSubscriber();
	return Promise.resolve(
		new WorkerImpl(
			registry,
			client.workflowRunRepository,
			workflowRunSubscriber,
			params,
		),
	);
}

export interface WorkerParams {
	id?: string;
	workflowRunSubscriber?: {
		pollIntervalMs?: number;
		maxBatchSize?: number;
		maxRetryDelayMs?: number;
	};
	maxConcurrentWorkflowRuns?: number;
	workflowRun?: {
		heartbeatIntervalMs?: number;
	};
	gracefulShutdownTimeoutMs?: number;
}

export interface Worker {
	id: string;
	registry: WorkflowRegistry;
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
	private activeWorkflowRunsById = new Map<string, ActiveWorkflowRun>();

	constructor(
		public readonly registry: WorkflowRegistry,
		private readonly workflowRunRepository: WorkflowRunRepository,
		private readonly workflowRunSubscriber: WorkflowRunSubscriber,
		private readonly params: WorkerParams,
	) {
		this.id = params.id ?? crypto.randomUUID();
		this.registerTerminationHandlers();
	}

	public async start(): Promise<void> {
		this.abortController = new AbortController();
		const abortSignal = this.abortController.signal;

		const config = this.getConfig();

		let nextDelayMs = config.pollIntervalMs;
		let subscriberFailedAttempts = 0;

		while (!abortSignal.aborted) {
			await delay(nextDelayMs, { abortSignal });

			const nextBatchSize = Math.min(
				config.maxConcurrent - this.activeWorkflowRunsById.size,
				config.maxBatchSize,
			);
			if (nextBatchSize <= 0) {
				nextDelayMs = config.pollIntervalMs;
				continue;
			}

			const nextBatchResult = await this.fetchNextWorkflowRunBatch(
				nextBatchSize,
				subscriberFailedAttempts,
				config,
			);
			if (nextBatchResult.type === "error") {
				subscriberFailedAttempts++;

				const retryParams = nextBatchResult.retryParams;
				if (!retryParams.retriesLeft) {
					await this.stop();
					break;
				}

				nextDelayMs = retryParams.delayMs;
				continue;
			}
			subscriberFailedAttempts = 0;

			if (!isNonEmptyArray(nextBatchResult.rows)) {
				nextDelayMs = config.pollIntervalMs;
				continue;
			}

			this.enqueueWorkflowRunBatch(nextBatchResult.rows, abortSignal, config);

			nextDelayMs = config.pollIntervalMs;
		}
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

	private getConfig() {
		return {
			pollIntervalMs: this.params.workflowRunSubscriber?.pollIntervalMs ?? 100,
			maxBatchSize: this.params.workflowRunSubscriber?.maxBatchSize ?? 1,
			maxRetryDelayMs: this.params.workflowRunSubscriber?.maxRetryDelayMs ?? 30_000,
			maxConcurrent: this.params.maxConcurrentWorkflowRuns ?? 1,
			heartbeatIntervalMs: this.params.workflowRun?.heartbeatIntervalMs ?? 30_000,
		};
	}

	private async fetchNextWorkflowRunBatch(
		size: number,
		attempts: number,
		config: ReturnType<typeof this.getConfig>,
	): Promise<
		| { type: "success"; rows: WorkflowRunRow<unknown, unknown>[] }
		| { type: "error"; retryParams: RetryParams }
	> {
		try {
			const workflowRunRows = await this.workflowRunSubscriber._nextBatch(size);
			return {
				type: "success",
				rows: workflowRunRows,
			};
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Worker ${this.id}: Error getting next workflow runs batch`, error);

			return {
				type: "error",
				retryParams: getRetryParams(attempts, {
					type: "jittered",
					maxAttempts: Infinity,
					baseDelayMs: config.pollIntervalMs,
					maxDelayMs: config.maxRetryDelayMs,
				}),
			};
		}
	}

	private enqueueWorkflowRunBatch(
		workflowRunRows: NonEmptyArray<WorkflowRunRow<unknown, unknown>>,
		abortSignal: AbortSignal,
		config: ReturnType<typeof this.getConfig>,
	): void {
		for (const workflowRunRow of workflowRunRows) {
			if (this.activeWorkflowRunsById.has(workflowRunRow.id)) {
				// deno-lint-ignore no-console
				console.log(`Workflow ${workflowRunRow.id} already in progress, skipping`);
				continue;
			}

			const workflow = this.registry._getByPath(workflowRunRow.workflow.path);
			if (!workflow) {
				// deno-lint-ignore no-console
				console.log(`No registered workflow on path: ${workflowRunRow.workflow.path}`);
				continue;
			}

			if (abortSignal.aborted) break;

			const workflowExecutionPromise = this.executeWorkflow(workflowRunRow, workflow, config);

			this.activeWorkflowRunsById.set(workflowRunRow.id, {
				run: workflowRunRow,
				executionPromise: workflowExecutionPromise,
			});
		}
	}

	private async executeWorkflow(
		workflowRunRow: WorkflowRunRow<unknown, unknown>,
		workflow: Workflow<unknown, unknown>,
		config: ReturnType<typeof this.getConfig>,
	): Promise<void> {
		let heartbeatInterval: number | undefined;
		try {
			const workflowRun = await initWorkflowRun({
				repository: this.workflowRunRepository,
				workflowRunRow,
			});

			heartbeatInterval = setInterval(async () => {
				try {
					await this.workflowRunRepository.updateHeartbeat(workflowRun.id);
				} catch (error) {
					// deno-lint-ignore no-console
					console.warn(`Worker ${this.id}: Failed to update workflow heartbeat ${workflowRun.id}`, error);
				}
			}, config.heartbeatIntervalMs);

			await workflow._execute({ workflowRun });
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Worker ${this.id}: Error processing workflow: ${workflowRunRow.id}`, error);
		} finally {
			if (heartbeatInterval) clearInterval(heartbeatInterval);
			this.activeWorkflowRunsById.delete(workflowRunRow.id);
		}
	}

	private registerTerminationHandlers(): void {
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			CrossPlatformProcess.addSignalListener(signal, async () => {
				// deno-lint-ignore no-console
				console.log(`Received ${signal}, gracefully shutting down worker...`);
				await this.stop();
				CrossPlatformProcess.exit(0);
			});
		}

		addEventListener("beforeunload", async (_event) => {
			// deno-lint-ignore no-console
			console.log("Application shutting down, stopping worker...");
			await this.stop();
		});
	}
}
