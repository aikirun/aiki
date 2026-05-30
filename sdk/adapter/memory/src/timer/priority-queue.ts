import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { createMinHeap } from "@aikirun/lib/collection/heap";
import type {
	CreateTimerPriorityQueue,
	DueTimer,
	TimerEntry,
	TimerPriorityQueue,
	TimerPriorityQueueContext,
	TimerSignalWaiter,
	TimerType,
} from "@aikirun/types/infra/timer";

interface TimerHeapItem {
	rank: number;
	type: TimerType;
	id: string;
}

// Ascending by rank.
// Ties broken by lexicographical order of `${type}:${id}`.
function compareTimerItems(a: TimerHeapItem, b: TimerHeapItem): number {
	if (a.rank !== b.rank) {
		return a.rank - b.rank;
	}
	const am = `${a.type}:${a.id}`;
	const bm = `${b.type}:${b.id}`;
	if (am < bm) {
		return -1;
	}
	if (am > bm) {
		return 1;
	}
	return 0;
}

/**
 * In-process TimerPriorityQueue backed by a min-heap and an internal signal queue.
 *
 * Returns a factory for creating the sorted set.
 *
 * State is allocated once per call to `inMemoryTimerPriorityQueue()` and persists
 * for the lifetime of the returned factory. That factory returns the
 * same underlying instance on every invocation, so a server can be stopped
 * and restarted (which re-invokes the factory) without losing queued timers.
 */
export function inMemoryTimerPriorityQueue(): CreateTimerPriorityQueue {
	const heap = createMinHeap<TimerHeapItem>(compareTimerItems);
	const signals: number[] = [];

	const waiterHandles = new Set<{ wake: () => void }>();

	function drainSignals(): number {
		let min: number | undefined;
		for (const signal of signals) {
			if (min === undefined || signal < min) {
				min = signal;
			}
		}
		signals.length = 0;
		return min ?? 0;
	}

	const timerPriorityQueue: TimerPriorityQueue = {
		async add(timers: NonEmptyArray<TimerEntry>): Promise<void> {
			let minDueAt = timers[0].dueAt;
			for (const timer of timers) {
				if (timer.dueAt < minDueAt) {
					minDueAt = timer.dueAt;
				}
				heap.push({ rank: timer.rank, type: timer.type, id: timer.id });
			}
			signals.push(minDueAt);
			waiterHandles.values().next().value?.wake();
		},

		async popDue(maxRank: number, limit: number): Promise<DueTimer[]> {
			const result: DueTimer[] = [];
			while (result.length < limit) {
				const next = heap.peek();
				if (next === undefined || next.rank > maxRank) {
					break;
				}
				heap.popMin();
				result.push({ rank: next.rank, type: next.type, id: next.id });
			}
			return result;
		},

		async peekNextRank(): Promise<number | null> {
			const next = heap.peek();
			return next === undefined ? null : next.rank;
		},

		createSignalWaiter(): TimerSignalWaiter {
			let waiterHandle:
				| {
						timeout: ReturnType<typeof setTimeout> | undefined;
						wake: () => void;
						close: () => void;
				  }
				| undefined;
			let closed = false;

			return {
				async wait(timeoutSeconds: number): Promise<number> {
					if (closed) {
						return 0;
					}
					if (signals.length > 0) {
						// Do not block if there are items in the set.
						// No need to peek the actual set since minSignal is min value in set
						return drainSignals();
					}

					return new Promise<number>((resolve) => {
						const detach = (): void => {
							if (waiterHandle) {
								if (waiterHandle.timeout !== undefined) {
									clearTimeout(waiterHandle.timeout);
								}
								waiterHandles.delete(waiterHandle);
								waiterHandle = undefined;
							}
						};

						waiterHandle = {
							// timeoutSeconds === 0 means block indefinitely
							// until a signal arrives or the waiter is closed
							timeout:
								timeoutSeconds > 0
									? setTimeout(() => {
											detach();
											signals.length = 0;
											resolve(0);
										}, timeoutSeconds * 1_000)
									: undefined,
							wake: () => {
								detach();
								// No need to do Math.min(popped, minSignal) cos wake is called sync after pop
								resolve(drainSignals());
							},
							close: () => {
								detach();
								resolve(0);
							},
						};

						waiterHandles.add(waiterHandle);
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
		},
	};

	return (_context: TimerPriorityQueueContext): TimerPriorityQueue => timerPriorityQueue;
}
