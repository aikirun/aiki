import { getRetryParams } from "@aiki/lib/retry";
import type { WorkflowRunId } from "@aiki/types/workflow-run";
import type {
	Client,
	PollingSubscriberStrategy,
	StrategyCallbacks,
	SubscriberDelayParams,
	SubscriberStrategyBuilder,
	WorkflowRunBatch,
} from "@aiki/types/client";

export function createPollingStrategy(
	client: Client<unknown>,
	strategy: PollingSubscriberStrategy,
): SubscriberStrategyBuilder {
	const intervalMs = strategy.intervalMs ?? 100;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

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
					maxAttempts: Infinity,
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

	const getNextBatch = async (size: number): Promise<WorkflowRunBatch[]> => {
		const response = await client.api.workflowRun.getReadyIdsV1({ size });
		return response.ids.map((id) => ({
			data: { workflowRunId: id as WorkflowRunId },
			meta: undefined,
		}));
	};

	return {
		init(_workerId: string, _callbacks: StrategyCallbacks) {
			return Promise.resolve({
				type: strategy.type,
				getNextDelay,
				getNextBatch,
			});
		},
	};
}
