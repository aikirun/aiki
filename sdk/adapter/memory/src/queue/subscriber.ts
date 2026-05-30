import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type {
	CreateSubscriber,
	Subscriber,
	SubscriberContext,
	SubscriberDelayParams,
	WorkflowRunMessage,
} from "@aikirun/types/infra/queue";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

import { getWorkflowQueueNames } from "./key";
import type { Store } from "./store";

export function createInMemorySubscriber(store: Store): CreateSubscriber {
	const getNextDelay = (delayParams: SubscriberDelayParams): number => {
		switch (delayParams.type) {
			case "no_work":
			case "retry":
				return 0;
			default:
				return delayParams satisfies never;
		}
	};

	return (context: SubscriberContext): Subscriber => {
		const { workflows, shards } = context;

		const queueNames = getWorkflowQueueNames(workflows, shards) as NonEmptyArray<string>;
		const queueNamesByIndex = new Map<string, number>();
		for (const [queueIndex, queueName] of queueNames.entries()) {
			queueNamesByIndex.set(queueName, queueIndex);
		}

		let waiterHandle:
			| {
					abortHandler: (() => void) | undefined;
					wake: (wakeQueueName: string) => void;
					close: () => void;
			  }
			| undefined;
		let closed = false;

		return {
			getNextDelay,

			async getReadyRuns(limit: number, options?: { abortSignal?: AbortSignal }): Promise<WorkflowRunMessage[]> {
				if (closed || options?.abortSignal?.aborted) {
					return [];
				}

				const initialBatch = store.roundRobinPop({ queueNames, startQueueIndex: 0, limit });
				if (initialBatch.length > 0) {
					return initialBatch;
				}

				return new Promise<WorkflowRunMessage[]>((resolve) => {
					const detach = (): void => {
						if (waiterHandle) {
							if (waiterHandle.abortHandler !== undefined) {
								options?.abortSignal?.removeEventListener("abort", waiterHandle.abortHandler);
							}
							waiterHandle = undefined;
						}
					};

					const handle = {
						wake: (wakeQueueName: string) => {
							// Walk declared queues round-robin starting at
							// the wake queue, popping items up to capacity and removing
							// this handle from each visited queue's waiter set.

							const queueCount = queueNames.length;

							const visited = new Array<boolean>(queueCount).fill(false);
							let visitedCount = 0;

							const isEmpty = new Array<boolean>(queueCount).fill(false);
							let emptyCount = 0;

							const wakeQueueIndex = queueNamesByIndex.get(wakeQueueName) ?? 0;
							let queueIndex = wakeQueueIndex - 1;

							const runs: WorkflowRunMessage[] = [];

							while (true) {
								queueIndex = (queueIndex + 1) % queueCount;
								const queueName = queueNames[queueIndex];
								const queue = queueName !== undefined ? store.getQueue(queueName) : undefined;

								if (!visited[queueIndex]) {
									queue?.waiterHandles.delete(handle);
									visited[queueIndex] = true;
									visitedCount += 1;
								}

								if (runs.length < limit && !isEmpty[queueIndex]) {
									const item = queue?.popMin();
									if (item === undefined) {
										isEmpty[queueIndex] = true;
										emptyCount += 1;
									} else {
										runs.push({ data: { id: item.id as WorkflowRunId } });
									}
								}

								if (visitedCount === queueCount && (runs.length === limit || emptyCount === queueCount)) {
									break;
								}
							}

							detach();
							resolve(runs);
						},

						close: () => {
							for (const queueName of queueNames) {
								store.getQueue(queueName)?.waiterHandles.delete(handle);
							}
							detach();
							resolve([]);
						},

						abortHandler: options?.abortSignal ? () => handle.close() : undefined,
					};

					waiterHandle = handle;

					if (handle.abortHandler !== undefined) {
						options?.abortSignal?.addEventListener("abort", handle.abortHandler, { once: true });
					}

					for (const queueName of queueNames) {
						store.getOrCreateQueue(queueName).waiterHandles.add(handle);
					}
				});
			},

			async close(): Promise<void> {
				if (closed) {
					return;
				}
				closed = true;
				waiterHandle?.close();
			},
		};
	};
}
