import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import { createMinHeap } from "@aikirun/lib/collection/heap";
import type {
	CreateTimerPriorityQueue,
	DueTimer,
	TimerAddResult,
	TimerEntry,
	TimerPriorityQueue,
	TimerPriorityQueueContext,
	TimerPriorityQueueWaiter,
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
 * Returns a factory for creating the queue.
 *
 * State is allocated once per call to `inMemoryTimerPriorityQueue()` and persists
 * for the lifetime of the returned factory. Every factory invocation returns a
 * queue over that same state, so a server can be stopped and restarted (which
 * re-invokes the factory) without losing queued timers.
 */
export function inMemoryTimerPriorityQueue(): CreateTimerPriorityQueue {
	const heap = createMinHeap<TimerHeapItem>(compareTimerItems);
	const signals: number[] = [];

	const waiterHandles = new Set<{ wake: () => void }>();

	function drainSignals(): { rank: number } | null {
		let min: number | undefined;
		for (const signal of signals) {
			if (min === undefined || signal < min) {
				min = signal;
			}
		}
		signals.length = 0;
		return min === undefined ? null : { rank: min };
	}

	return (_context: TimerPriorityQueueContext): TimerPriorityQueue => ({
		async add(timers: NonEmptyArray<TimerEntry>): Promise<TimerAddResult> {
			const minRank = heap.peek()?.rank;

			let proposedMinRank = timers[0].rank;
			for (const timer of timers) {
				if (timer.rank < proposedMinRank) {
					proposedMinRank = timer.rank;
				}
				heap.push({ rank: timer.rank, type: timer.type, id: timer.id });
			}

			// A signal exists to shorten the waiter's sleep. A timer that is not the
			// new earliest is already covered by the wake the waiter has scheduled
			// for the current earliest, so only a new front-of-queue sends one.
			if (minRank === undefined || proposedMinRank < minRank) {
				signals.push(proposedMinRank);
				waiterHandles.values().next().value?.wake();
			}

			return { status: "added" };
		},

		async popDue({ maxRank, limit }: { maxRank: number; limit: number }): Promise<DueTimer[]> {
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

		async peekNext(): Promise<{ rank: number } | null> {
			const next = heap.peek();
			return next === undefined ? null : { rank: next.rank };
		},

		createWaiter(): TimerPriorityQueueWaiter {
			let waiterHandle:
				| {
						timeout: ReturnType<typeof setTimeout> | undefined;
						wake: () => void;
						close: () => void;
				  }
				| undefined;
			let closed = false;

			return {
				async wait(timeoutSeconds: number): Promise<{ rank: number } | null> {
					if (closed) {
						return null;
					}
					if (signals.length > 0) {
						// Do not block if there are items in the set.
						// No need to peek the actual set since minSignal is min value in set
						return drainSignals();
					}

					return new Promise<{ rank: number } | null>((resolve) => {
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
											resolve(null);
										}, timeoutSeconds * 1_000)
									: undefined,
							wake: () => {
								detach();
								// No need to do Math.min(popped, minSignal) cos wake is called sync after pop
								resolve(drainSignals());
							},
							close: () => {
								detach();
								resolve(null);
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
	});
}
