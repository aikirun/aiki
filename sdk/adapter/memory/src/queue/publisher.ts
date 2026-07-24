import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type {
	CreatePublisher,
	Publisher,
	PublisherContext,
	PublishRunsResult,
	ReadyWorkflowRun,
} from "@aikirun/types/infra/queue";

import { getWorkflowQueueName } from "./key";
import type { Queue, Store } from "./store";

export function createInMemoryPublisher(store: Store): CreatePublisher {
	return (_context: PublisherContext): Publisher => ({
		async publishReadyRuns(runs: NonEmptyArray<ReadyWorkflowRun>): Promise<PublishRunsResult> {
			const touchedQueues = new Map<string, Queue>();
			for (const { id, name, versionId, rank, shard } of runs) {
				const queueName = getWorkflowQueueName(name, versionId, shard);
				const queue = store.getOrCreateQueue(queueName);
				queue.push({ rank, id });
				touchedQueues.set(queueName, queue);
			}

			for (const [queueName, queue] of touchedQueues) {
				while (queue.size > 0 && queue.waiterHandles.size > 0) {
					queue.waiterHandles.values().next().value?.wake(queueName);
				}
			}

			return { published: runs.map((run) => ({ run })) };
		},
	});
}
