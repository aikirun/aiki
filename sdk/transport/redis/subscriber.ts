import { isNonEmptyArray, shuffleArray } from "@aikirun/lib/array";
import { getRetryParams } from "@aikirun/lib/retry";
import type {
	CreateSubscriber,
	Subscriber,
	SubscriberContext,
	SubscriberDelayParams,
	WorkflowRunBatch,
} from "@aikirun/types/subscriber";
import type { WorkflowMeta } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { Redis } from "ioredis";

export interface RedisSubscriberParams {
	host: string;
	port: number;
	password?: string;
	db?: number;
	options?: RedisSubscriberOptions;
}

export interface RedisSubscriberOptions {
	connectTimeoutMs?: number;
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

export function redisSubscriber(params: RedisSubscriberParams): CreateSubscriber {
	const { options } = params;
	const maxRetryIntervalMs = options?.maxRetryIntervalMs ?? 30_000;

	const getNextDelay = (delayParams: SubscriberDelayParams) => {
		switch (delayParams.type) {
			case "no_work":
				return 0;
			case "retry": {
				const retryParams = getRetryParams(delayParams.attemptNumber, {
					type: "jittered",
					maxAttempts: Number.POSITIVE_INFINITY,
					baseDelayMs: 1_000,
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
		const { workflows, shards } = context;

		const redis = new Redis({
			host: params.host,
			port: params.port,
			password: params.password,
			db: params.db,
			maxRetriesPerRequest: 0,
			enableOfflineQueue: false,
			connectTimeout: options?.connectTimeoutMs,
		});

		const queueNames = getWorkflowQueueNames(workflows, shards);

		return {
			getNextDelay,
			async getNextBatch(size: number): Promise<WorkflowRunBatch[]> {
				const shuffledQueueNames = shuffleArray(queueNames);
				const firstItem = (await redis.bzpopmin(...shuffledQueueNames, 0)) as
					| [key: string, member: WorkflowRunId, score: string]
					| null;
				if (firstItem === null) {
					return [];
				}

				const batch: WorkflowRunBatch[] = [{ data: { workflowRunId: firstItem[1] } }];

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

function getWorkflowQueueName(name: string, versionId: string, shard?: string): string {
	return shard ? `aiki:workflow:${name}:${versionId}:${shard}` : `aiki:workflow:${name}:${versionId}`;
}
