import { getRetryParams } from "@aiki/lib/retry";
import type { WorkflowRunId } from "@aiki/contract/workflow-run";
import type { Client } from "../client.ts";
import type { StrategyCallbacks, SubscriberDelayContext, SubscriberStrategyBuilder } from "./strategy-resolver.ts";

/**
 * Simple polling subscriber strategy configuration
 */
export interface PollingSubscriberStrategy {
	type: "polling";

	/**
	 * Polling interval in milliseconds
	 * @default 100
	 */
	intervalMs?: number;

	/**
	 * Maximum retry interval in milliseconds when polling fails
	 * @default 30_000
	 */
	maxRetryIntervalMs?: number;

	/**
	 * Polling interval when at capacity (milliseconds)
	 * @default 50
	 */
	atCapacityIntervalMs?: number;
}

export function createPollingStrategy(
	client: Client,
	strategy: PollingSubscriberStrategy,
): SubscriberStrategyBuilder {
	const intervalMs = strategy.intervalMs ?? 100;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;

	const getNextDelay = (ctx: SubscriberDelayContext) => {
		switch (ctx.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "at_capacity":
				return atCapacityIntervalMs;
			case "retry": {
				const retryParams = getRetryParams(ctx.attemptNumber, {
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
				return ctx satisfies never;
		}
	};

	const getNextBatch = async (size: number): Promise<WorkflowRunId[]> => {
		const response = await client.api.workflowRun.getReadyIdsV1({ size });
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
