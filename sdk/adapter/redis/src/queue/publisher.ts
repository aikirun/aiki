import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type {
	CreatePublisher,
	Publisher,
	PublishRunsResult,
	PublishRunsResultBucket,
	ReadyWorkflowRun,
} from "@aikirun/types/infra/queue";
import type { Redis } from "ioredis";

import { getWorkflowQueueName } from "./key";
import { connectionTracker } from "../connection";

interface QueueData {
	runs: ReadyWorkflowRun[];
	args: (string | number)[];
}

export function redisPublisher(redis: Redis): CreatePublisher {
	return ({ logger }): Publisher => {
		const redisTracker = connectionTracker(redis);

		return {
			async publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<PublishRunsResult> {
				if (!redisTracker.isAvailable()) {
					return { failed: runs.map((run) => ({ run })) };
				}

				const dataByQueueName = new Map<string, QueueData>();
				for (const run of runs) {
					const queueName = getWorkflowQueueName(run.name, run.versionId, run.shard);
					const queueData = dataByQueueName.get(queueName);
					if (!queueData) {
						dataByQueueName.set(queueName, { runs: [run], args: [run.rank, run.id] });
					} else {
						queueData.runs.push(run);
						queueData.args.push(run.rank, run.id);
					}
				}

				const redisPipeline = redis.pipeline();
				const queueDataBatch: QueueData[] = [];
				for (const [queueName, queueData] of dataByQueueName) {
					redisPipeline.zadd(queueName, ...queueData.args);
					queueDataBatch.push(queueData);
				}

				const results = await redisPipeline.exec();
				if (results === null) {
					logger.warn("Publish pipeline returned no results, treating runs as failed", {
						"aiki.count": runs.length,
					});
					return { failed: runs.map((run) => ({ run })) };
				}

				const published: PublishRunsResultBucket = [];
				const failed: PublishRunsResultBucket = [];
				let err: Error | undefined;
				for (const [i, queueData] of queueDataBatch.entries()) {
					const result = results[i];
					const commandError = result === undefined ? new Error("Pipeline returned no result for command") : result[0];
					if (commandError !== null) {
						err ??= commandError;
						for (const run of queueData.runs) {
							failed.push({ run });
						}
					} else {
						for (const run of queueData.runs) {
							published.push({ run });
						}
					}
				}

				if (err) {
					logger.warn("Publish command failed, treating its runs as failed", {
						err,
						"aiki.count": failed.length,
					});
				}

				const result: PublishRunsResult = {};
				if (published.length > 0) {
					result.published = published;
				}
				if (failed.length > 0) {
					result.failed = failed;
				}
				return result;
			},
		};
	};
}
