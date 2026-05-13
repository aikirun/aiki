import type { Redis } from "ioredis";

import type { WorkflowRunPublisher, WorkflowRunReadyMessage } from "../types";

function getWorkflowQueueName(name: string, versionId: string, shard?: string): string {
	return shard ? `aiki:workflow:${name}:${versionId}:${shard}` : `aiki:workflow:${name}:${versionId}`;
}

export function createWorkflowRunPublisher(redis: Redis): WorkflowRunPublisher {
	return {
		async publishReadyRuns(runs: WorkflowRunReadyMessage[]): Promise<void> {
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
