import { isNonEmptyArray, shuffleArray } from "@aikirun/lib/array";
import { getRetryParams } from "@aikirun/lib/retry";
import type {
	CreateSubscriber,
	Subscriber,
	SubscriberContext,
	SubscriberDelayParams,
	WorkflowRunMessage,
} from "@aikirun/types/subscriber";
import type { WorkflowMeta } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { Redis } from "ioredis";

import { getWorkflowQueueName } from "./keys";
import { attachConnectionSupervisor, type RedisConnectionParams } from "../connection";

export interface RedisSubscriberOptions {
	maxRetryIntervalMs?: number;
}

/**
 * Pop items from multiple sorted sets in round-robin fashion.
 * KEYS: sorted set keys to pop from
 * ARGV[1]: total capacity to fill
 * Returns: flat array of workflowRunIds
 */
const ROUND_ROBIN_ZPOPMIN_SCRIPT = `
local capacity = tonumber(ARGV[1])
local results = {}
local keyCount = #KEYS
local emptyKeys = {}
local emptyKeyCount = 0

while #results < capacity and emptyKeyCount < keyCount do
  for i = 1, keyCount do
    if #results >= capacity then
      break
    end
    if not emptyKeys[i] then
      local item = redis.call('ZPOPMIN', KEYS[i])
      if #item == 0 then
        emptyKeys[i] = true
        emptyKeyCount = emptyKeyCount + 1
      else
        results[#results + 1] = item[1]
      end
    end
  end
end

return results
`;

/**
 * Builds a Redis-backed subscriber that workers use to pull ready workflow
 * runs from sorted-set queues.
 *
 * The factory takes connection params (rather than a pre-constructed ioredis
 * client) for two reasons:
 *
 * 1. The subscriber requires specific ioredis settings — `maxRetriesPerRequest: 0`
 *    and `enableOfflineQueue: false` — so that connection failures surface to
 *    the worker's retry/backoff loop instead of being silently absorbed. These
 *    settings can only be applied at construction time, so the factory owns
 *    client creation to guarantee them.
 *
 * 2. Each spawned worker gets its own connection. The subscriber uses
 *    `BZPOPMIN`, a blocking command that ties up the underlying connection
 *    while it waits, so connections cannot be shared across concurrent
 *    workers.
 */
export function redisSubscriber(params: RedisConnectionParams, options?: RedisSubscriberOptions): CreateSubscriber {
	const intervalMs = 1_000;
	const maxRetryIntervalMs = options?.maxRetryIntervalMs ?? 30_000;

	const getNextDelay = (delayParams: SubscriberDelayParams) => {
		switch (delayParams.type) {
			case "no_work":
				return intervalMs;
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
		const connectTimeoutMs = params?.connectTimeoutMs ?? 5_000;
		const { workflows, shards, logger } = context;

		const redis = new Redis({
			host: params.host,
			port: params.port,
			password: params.password,
			db: params.db,
			maxRetriesPerRequest: 0,
			enableOfflineQueue: false,
			connectTimeout: connectTimeoutMs,
		});
		redis.on("ready", () => logger.info("Redis connection established"));
		const connectionSupervisor = attachConnectionSupervisor(redis, { logger });

		const queueNames = getWorkflowQueueNames(workflows, shards);

		return {
			getNextDelay,
			async getReadyRuns(size: number): Promise<WorkflowRunMessage[]> {
				const shuffledQueueNames = shuffleArray(queueNames);
				const firstItem = (await redis.bzpopmin(...shuffledQueueNames, 0)) as
					| [key: string, member: WorkflowRunId, score: string]
					| null;
				if (firstItem === null) {
					return [];
				}

				const batch: WorkflowRunMessage[] = [{ data: { workflowRunId: firstItem[1] } }];

				const remainingCapacity = size - 1;
				if (remainingCapacity > 0) {
					const workflowRunIds = (await redis.eval(
						ROUND_ROBIN_ZPOPMIN_SCRIPT,
						queueNames.length,
						...queueNames,
						remainingCapacity
					)) as WorkflowRunId[];

					for (const workflowRunId of workflowRunIds) {
						batch.push({ data: { workflowRunId: workflowRunId } });
					}
				}

				return batch;
			},
			async close(): Promise<void> {
				connectionSupervisor.detach();
				redis.disconnect();
			},
		};
	};
}

function getWorkflowQueueNames(workflows: WorkflowMeta[], shards?: string[]): string[] {
	if (!isNonEmptyArray(shards)) {
		return workflows.map((workflow) => getWorkflowQueueName(workflow.name, workflow.versionId));
	}

	return workflows.flatMap((workflow) =>
		shards.map((shard) => getWorkflowQueueName(workflow.name, workflow.versionId, shard))
	);
}
