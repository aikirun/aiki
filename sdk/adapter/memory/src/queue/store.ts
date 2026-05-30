import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { createMinHeap } from "@aikirun/lib/collection/heap";
import type { WorkflowRunMessage } from "@aikirun/types/infra/queue";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

export interface QueueItem {
	rank: number;
	id: string;
}

export interface Queue {
	readonly size: number;
	waiterHandles: Set<{ wake: (wakeQueueName: string) => void }>;

	push(item: QueueItem): void;
	popMin(): QueueItem | undefined;
}

export interface Store {
	getOrCreateQueue(queueName: string): Queue;
	getQueue(queueName: string): Queue | undefined;
	/**
	 * Pop items from the specified queues in round-robin order, starting at
	 * `startQueueIndex`. Each queue is visited once per round; an item is popped if
	 * the queue is non-empty. Stops when limit is reached or every queue is
	 * empty.
	 */
	roundRobinPop(params: {
		queueNames: NonEmptyArray<string>;
		startQueueIndex: number;
		limit: number;
	}): WorkflowRunMessage[];
}

// Ascending by rank.
// Ties broken by lexicographical order of id.
function compareQueueItems(a: QueueItem, b: QueueItem): number {
	if (a.rank !== b.rank) {
		return a.rank - b.rank;
	}
	if (a.id < b.id) {
		return -1;
	}
	if (a.id > b.id) {
		return 1;
	}
	return 0;
}

function createQueue(): Queue {
	const heap = createMinHeap<QueueItem>(compareQueueItems);

	return {
		get size(): number {
			return heap.size;
		},

		waiterHandles: new Set(),

		push(item: QueueItem): void {
			heap.push(item);
		},

		popMin(): QueueItem | undefined {
			return heap.popMin();
		},
	};
}

export function createStore(): Store {
	const queuesByName = new Map<string, Queue>();

	return {
		getOrCreateQueue(queueName): Queue {
			let queue = queuesByName.get(queueName);
			if (queue === undefined) {
				queue = createQueue();
				queuesByName.set(queueName, queue);
			}
			return queue;
		},

		getQueue(queueName): Queue | undefined {
			return queuesByName.get(queueName);
		},

		roundRobinPop({ queueNames, startQueueIndex, limit }): WorkflowRunMessage[] {
			if (limit <= 0) {
				return [];
			}

			const queueCount = queueNames.length;

			const isEmpty = new Array<boolean>(queueCount).fill(false);
			let emptyCount = 0;

			let queueIndex = startQueueIndex - 1;

			const runs: WorkflowRunMessage[] = [];

			while (runs.length < limit && emptyCount < queueCount) {
				queueIndex = (queueIndex + 1) % queueCount;
				if (isEmpty[queueIndex]) {
					continue;
				}
				const queueName = queueNames[queueIndex];
				const queue = queueName !== undefined ? queuesByName.get(queueName) : undefined;
				const item = queue?.popMin();
				if (item === undefined) {
					isEmpty[queueIndex] = true;
					emptyCount += 1;
				} else {
					runs.push({ data: { id: item.id as WorkflowRunId } });
				}
			}

			return runs;
		},
	};
}
