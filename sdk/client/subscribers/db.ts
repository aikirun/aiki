import { isNonEmptyArray } from "@aikirun/lib";
import { getRetryParams } from "@aikirun/lib/retry";
import type {
	Client,
	DbSubscriberStrategy,
	StrategyCallbacks,
	SubscriberDelayParams,
	SubscriberStrategyBuilder,
	WorkflowRunBatch,
} from "@aikirun/types/client";
import type { WorkflowMeta } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";

export function createDbStrategy(
	client: Client,
	strategy: DbSubscriberStrategy,
	workflows: WorkflowMeta[],
	workerShards?: string[]
): SubscriberStrategyBuilder {
	const logger = client.logger.child({
		"aiki.component": "db-subscriber",
	});

	const intervalMs = strategy.intervalMs ?? 1_000;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 500;
	const claimMinIdleTimeMs = strategy.claimMinIdleTimeMs ?? 90_000;

	const workflowFilters = !isNonEmptyArray(workerShards)
		? workflows.map((workflow) => ({ name: workflow.name, versionId: workflow.versionId }))
		: workflows.flatMap((workflow) =>
				workerShards.map((shard) => ({ name: workflow.name, versionId: workflow.versionId, shard }) as const)
			);

	const getNextDelay = (params: SubscriberDelayParams) => {
		switch (params.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "at_capacity":
				return atCapacityIntervalMs;
			case "retry": {
				const retryParams = getRetryParams(params.attemptNumber, {
					type: "jittered",
					maxAttempts: Number.POSITIVE_INFINITY,
					baseDelayMs: intervalMs,
					maxDelayMs: maxRetryIntervalMs,
				});
				if (!retryParams.retriesLeft) {
					return maxRetryIntervalMs;
				}
				return retryParams.delayMs;
			}
			default:
				return params satisfies never;
		}
	};

	return {
		async init(workerId: string, _callbacks: StrategyCallbacks) {
			return {
				type: strategy.type,
				getNextDelay,
				getNextBatch: async (size: number): Promise<WorkflowRunBatch[]> => {
					const response = await client.api.workflowRun.claimReadyV1({
						workerId,
						workflows: workflowFilters,
						limit: size,
						claimMinIdleTimeMs,
					});

					return response.runs.map((run) => ({
						data: { workflowRunId: run.id as WorkflowRunId },
					}));
				},
				heartbeat: async (workflowRunId: WorkflowRunId): Promise<void> => {
					try {
						await client.api.workflowRun.heartbeatV1({ id: workflowRunId });
						logger.debug("Heartbeat sent", {
							"aiki.workerId": workerId,
							"aiki.workflowRunId": workflowRunId,
						});
					} catch (error) {
						logger.warn("Heartbeat failed", {
							"aiki.workerId": workerId,
							"aiki.workflowRunId": workflowRunId,
							"aiki.error": error instanceof Error ? error.message : String(error),
						});
					}
				},
				acknowledge: async (): Promise<void> => {},
			};
		},
	};
}
