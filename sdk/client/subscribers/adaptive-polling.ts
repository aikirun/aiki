import { type AdaptivePollingConfig, AdaptivePollingStrategy } from "@aiki/lib/polling";
import type { WorkflowRunId } from "@aiki/contract/workflow-run";
import type { ApiClient } from "../client.ts";
import type { StrategyCallbacks, SubscriberDelayParams, SubscriberStrategyBuilder } from "./strategy-resolver.ts";

/**
 * Adaptive polling subscriber strategy configuration
 */
export interface AdaptivePollingSubscriberStrategy extends AdaptivePollingConfig {
	type: "adaptive_polling";

	/**
	 * Polling interval when at capacity (milliseconds)
	 * @default 50
	 */
	atCapacityIntervalMs?: number;
}

export function createAdaptivePollingStrategy(
	api: ApiClient,
	strategy: AdaptivePollingSubscriberStrategy,
): SubscriberStrategyBuilder {
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

	const adaptive = new AdaptivePollingStrategy(strategy);

	const getNextDelay = (params: SubscriberDelayParams) => {
		switch (params.type) {
			case "polled":
				return params.foundWork ? adaptive.recordWorkFound() : adaptive.recordNoWork();
			case "retry":
				return adaptive.forceSlowPolling();
			case "heartbeat":
				return adaptive.recordNoWork();
			case "at_capacity":
				return atCapacityIntervalMs;
			default:
				return params satisfies never;
		}
	};

	const getNextBatch = async (size: number): Promise<WorkflowRunId[]> => {
		const response = await api.workflowRun.getReadyIdsV1({ size });
		return response.ids as WorkflowRunId[];
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
