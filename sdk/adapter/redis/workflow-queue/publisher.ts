import type { NonEmptyArray } from "@aikirun/types/array";
import type { Publisher, ReadyWorkflowRun } from "@aikirun/types/publisher";
import type { Redis } from "ioredis";

import { getWorkflowQueueName } from "./keys";

export function redisPublisher(redis: Redis): Publisher {
	return {
		async publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<void> {
			const redisPipeline = redis.pipeline();

			const argsByQueueName = new Map<string, (string | number)[]>();
			for (const { id, name, versionId, rank, shard } of runs) {
				const queueName = getWorkflowQueueName(name, versionId, shard);
				const args = argsByQueueName.get(queueName);
				if (!args) {
					argsByQueueName.set(queueName, [rank, id]);
				} else {
					args.push(rank, id);
				}
			}

			for (const [queueName, args] of argsByQueueName) {
				redisPipeline.zadd(queueName, ...args);
			}

			await redisPipeline.exec();
		},
	};
}
