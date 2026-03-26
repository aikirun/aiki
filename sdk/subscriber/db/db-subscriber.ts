import { isNonEmptyArray } from "@aikirun/lib/array";
import { getRetryParams } from "@aikirun/lib/retry";
import type { ApiClient } from "@aikirun/types/client";
import type {
	CreateSubscriber,
	Subscriber,
	SubscriberContext,
	SubscriberDelayParams,
	WorkflowRunBatch,
} from "@aikirun/types/subscriber";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";

export interface DbSubscriberParams {
	api: ApiClient;
	intervalMs?: number;
	maxRetryIntervalMs?: number;
	atCapacityIntervalMs?: number;
	claimMinIdleTimeMs?: number;
}

export function dbSubscriber(params: DbSubscriberParams): CreateSubscriber {
	const { api } = params;
	const intervalMs = params.intervalMs ?? 1_000;
	const maxRetryIntervalMs = params.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = params.atCapacityIntervalMs ?? 500;
	const claimMinIdleTimeMs = params.claimMinIdleTimeMs ?? 90_000;

	const getNextDelay = (delayParams: SubscriberDelayParams) => {
		switch (delayParams.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "at_capacity":
				return atCapacityIntervalMs;
			case "retry": {
				const retryParams = getRetryParams(delayParams.attemptNumber, {
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
				return delayParams satisfies never;
		}
	};

	return (context: SubscriberContext): Subscriber => {
		const { workerId, workflows, shards } = context;

		const workflowFilters = !isNonEmptyArray(shards)
			? workflows.map((workflow) => ({ name: workflow.name, versionId: workflow.versionId }))
			: workflows.flatMap((workflow) =>
					shards.map((shard) => ({ name: workflow.name, versionId: workflow.versionId, shard }) as const)
				);

		return {
			getNextDelay,
			async getNextBatch(size: number): Promise<WorkflowRunBatch[]> {
				const response = await api.workflowRun.claimReadyV1({
					workerId,
					workflows: workflowFilters,
					limit: size,
					claimMinIdleTimeMs,
				});

				return response.runs.map((run) => ({
					data: { workflowRunId: run.id as WorkflowRunId },
				}));
			},
			heartbeat: (workflowRunId: WorkflowRunId) => api.workflowRun.heartbeatV1({ id: workflowRunId }),
		};
	};
}
