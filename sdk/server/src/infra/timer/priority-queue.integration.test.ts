import type { TimerPriorityQueue, TimerPriorityQueueWaiter } from "@aikirun/types/infra/timer";

import { describe, expect, test } from "bun:test";
import { withTimerPriorityQueue } from "../../testing/harness";

describe("timer priority queue", () => {
	describe("add", () => {
		test("add reports the batch as added", () =>
			withTimerPriorityQueue(async (queue) => {
				const result = await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);
				expect(result).toEqual({ status: "added" });
			}));
	});

	describe("popDue", () => {
		test("popDue removes and returns the timers at or below the max rank, earliest first", () =>
			withTimerPriorityQueue(async (queue) => {
				await queue.add([
					{ type: "sleep", id: "timer-a", rank: 10 },
					{ type: "scheduled", id: "timer-c", rank: 30 },
					{ type: "retry", id: "timer-b", rank: 20 },
				]);

				const dueTimers = await queue.popDue({ maxRank: 20, limit: 10 });

				expect(dueTimers).toEqual([
					{ type: "sleep", id: "timer-a", rank: 10 },
					{ type: "retry", id: "timer-b", rank: 20 },
				]);
				expect(await queue.peekNext()).toEqual({ rank: 30 });
			}));

		test("popDue honors the limit and leaves the remainder for the next call", () =>
			withTimerPriorityQueue(async (queue) => {
				await queue.add([
					{ type: "sleep", id: "timer-a", rank: 10 },
					{ type: "scheduled", id: "timer-c", rank: 30 },
					{ type: "retry", id: "timer-b", rank: 20 },
				]);

				const firstChunk = await queue.popDue({ maxRank: 30, limit: 2 });
				const secondChunk = await queue.popDue({ maxRank: 30, limit: 2 });

				expect(firstChunk).toEqual([
					{ type: "sleep", id: "timer-a", rank: 10 },
					{ type: "retry", id: "timer-b", rank: 20 },
				]);
				expect(secondChunk).toEqual([{ type: "scheduled", id: "timer-c", rank: 30 }]);
			}));

		test("popDue returns nothing when no timer is at or below the max rank", () =>
			withTimerPriorityQueue(async (queue) => {
				await queue.add([{ type: "sleep", id: "timer-a", rank: 30 }]);

				expect(await queue.popDue({ maxRank: 29, limit: 10 })).toEqual([]);
				expect(await queue.peekNext()).toEqual({ rank: 30 });
			}));

		test("popDue on an empty queue returns nothing", () =>
			withTimerPriorityQueue(async (queue) => {
				expect(await queue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([]);
			}));
	});

	describe("peekNext", () => {
		test("peekNext returns the earliest entry without removing it", () =>
			withTimerPriorityQueue(async (queue) => {
				await queue.add([
					{ type: "retry", id: "timer-b", rank: 20 },
					{ type: "sleep", id: "timer-a", rank: 10 },
				]);

				expect(await queue.peekNext()).toEqual({ rank: 10 });
				expect(await queue.peekNext()).toEqual({ rank: 10 });
				expect(await queue.popDue({ maxRank: 30, limit: 10 })).toHaveLength(2);
			}));

		test("peekNext is null on an empty queue", () =>
			withTimerPriorityQueue(async (queue) => {
				expect(await queue.peekNext()).toBeNull();
			}));
	});

	describe("waiter", () => {
		async function withTimerPriorityQueueAndWaiter(
			fn: (queue: TimerPriorityQueue, waiter: TimerPriorityQueueWaiter) => Promise<void>
		): Promise<void> {
			await withTimerPriorityQueue(async (queue) => {
				const waiter = queue.createWaiter();
				try {
					await fn(queue, waiter);
				} finally {
					await waiter.close();
				}
			});
		}

		test("an add into an empty queue wakes the waiter with the batch's minimum rank", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				await queue.add([
					{ type: "sleep", id: "timer-a", rank: 30 },
					{ type: "retry", id: "timer-b", rank: 15 },
				]);

				expect(await waiter.wait(0)).toEqual({ rank: 15 });
			}));

		test("an add that beats the current earliest wakes the waiter with the new minimum", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				await queue.add([{ type: "sleep", id: "timer-a", rank: 50 }]);
				expect(await waiter.wait(0)).toEqual({ rank: 50 });

				await queue.add([{ type: "retry", id: "timer-b", rank: 40 }]);

				expect(await waiter.wait(0)).toEqual({ rank: 40 });
			}));

		test("an add behind the current earliest does not wake the waiter", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);
				expect(await waiter.wait(0)).toEqual({ rank: 10 });

				await queue.add([{ type: "retry", id: "timer-b", rank: 20 }]);

				// Absence check: a timer behind the current earliest never needs to wake a
				// waiter, so the only correct outcome is a timeout.
				expect(await waiter.wait(0.1)).toBeNull();
				expect(await queue.popDue({ maxRank: 30, limit: 10 })).toEqual([
					{ type: "sleep", id: "timer-a", rank: 10 },
					{ type: "retry", id: "timer-b", rank: 20 },
				]);
			}));

		test("an add that ties the current earliest does not wake the waiter", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);
				expect(await waiter.wait(0)).toEqual({ rank: 10 });

				await queue.add([{ type: "retry", id: "timer-b", rank: 10 }]);

				expect(await waiter.wait(0.1)).toBeNull();
			}));

		test("a parked waiter wakes on a qualifying add", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				await queue.add([{ type: "sleep", id: "timer-a", rank: 50 }]);
				expect(await waiter.wait(0)).toEqual({ rank: 50 });

				const waitPromise = waiter.wait(0);
				await queue.add([{ type: "retry", id: "timer-b", rank: 5 }]);

				expect(await waitPromise).toEqual({ rank: 5 });
			}));

		test("close resolves a parked wait with null", () =>
			withTimerPriorityQueueAndWaiter(async (queue, waiter) => {
				// The first wake completes any lazy connection setup, so the second wait
				// is genuinely parked when close arrives.
				await queue.add([{ type: "sleep", id: "timer-a", rank: 50 }]);
				expect(await waiter.wait(0)).toEqual({ rank: 50 });

				const waitPromise = waiter.wait(0);
				await waiter.close();

				expect(await waitPromise).toBeNull();
			}));
	});
});
