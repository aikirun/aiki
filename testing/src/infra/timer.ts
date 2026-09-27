import type { TimerPriorityQueue, TimerPriorityQueueWaiter } from "@aikirun/types/infra/timer";

/** The subset of a test framework's `expect(...)` result the test suite uses. */
interface Expectation {
	toEqual(expected: unknown): void;
	toBeNull(): void;
	toHaveLength(length: number): void;
}

/**
 * The test-framework functions the test suite registers its tests with.
 * The `describe`/`test`/`expect` exported by bun:test, vitest, and jest
 * all satisfy this shape.
 */
interface TestRunner {
	describe(name: string, body: () => void): void;
	test(name: string, body: () => Promise<void>): void;
	expect(actual: unknown): Expectation;
}

/**
 * Provides a queue to one test. Called once per test; hand `fn` a fresh,
 * empty queue, and tear it down after `fn` resolves. Isolation between calls
 * is the implementer's job — reuse a connection if you like, but no timers
 * may survive from one call to the next.
 */
export type WithTimerPriorityQueue = (fn: (queue: TimerPriorityQueue) => Promise<void>) => Promise<void>;

/**
 * Registers the timer priority queue test suite against an implementation.
 * Passing the suite means Aiki's server daemons behave correctly with the
 * queue: pop ordering, rank cutoffs, and waiter wake semantics including
 * wake suppression. The suite does not exercise durability, reconnects, or
 * concurrent consumers — the queue is an at-least-once acceleration layer
 * and the database remains the source of truth, so those stay the
 * implementer's own testing job.
 */
export function timerPriorityQueueTestSuite(runner: TestRunner, withQueue: WithTimerPriorityQueue): void {
	const { describe, test, expect } = runner;

	describe("timer priority queue", () => {
		describe("add", () => {
			test("add reports the batch as added", () =>
				withQueue(async (queue) => {
					const result = await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);
					expect(result).toEqual({ status: "added" });
				}));
		});

		describe("popDue", () => {
			test("popDue removes and returns the timers at or below the max rank, earliest first", () =>
				withQueue(async (queue) => {
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
				withQueue(async (queue) => {
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
				withQueue(async (queue) => {
					await queue.add([{ type: "sleep", id: "timer-a", rank: 30 }]);

					expect(await queue.popDue({ maxRank: 29, limit: 10 })).toEqual([]);
					expect(await queue.peekNext()).toEqual({ rank: 30 });
				}));

			test("popDue on an empty queue returns nothing", () =>
				withQueue(async (queue) => {
					expect(await queue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([]);
				}));
		});

		describe("peekNext", () => {
			test("peekNext returns the earliest entry without removing it", () =>
				withQueue(async (queue) => {
					await queue.add([
						{ type: "retry", id: "timer-b", rank: 20 },
						{ type: "sleep", id: "timer-a", rank: 10 },
					]);

					expect(await queue.peekNext()).toEqual({ rank: 10 });
					expect(await queue.peekNext()).toEqual({ rank: 10 });
					expect(await queue.popDue({ maxRank: 30, limit: 10 })).toHaveLength(2);
				}));

			test("peekNext is null on an empty queue", () =>
				withQueue(async (queue) => {
					expect(await queue.peekNext()).toBeNull();
				}));
		});

		describe("waiter", () => {
			async function withQueueAndWaiter(
				fn: (queue: TimerPriorityQueue, waiter: TimerPriorityQueueWaiter) => Promise<void>
			): Promise<void> {
				await withQueue(async (queue) => {
					const waiter = queue.createWaiter();
					try {
						await fn(queue, waiter);
					} finally {
						await waiter.close();
					}
				});
			}

			test("an add into an empty queue wakes the waiter with the batch's minimum rank", () =>
				withQueueAndWaiter(async (queue, waiter) => {
					await queue.add([
						{ type: "sleep", id: "timer-a", rank: 30 },
						{ type: "retry", id: "timer-b", rank: 15 },
					]);

					expect(await waiter.wait(0)).toEqual({ rank: 15 });
				}));

			test("an add that beats the current earliest wakes the waiter with the new minimum", () =>
				withQueueAndWaiter(async (queue, waiter) => {
					await queue.add([{ type: "sleep", id: "timer-a", rank: 50 }]);
					expect(await waiter.wait(0)).toEqual({ rank: 50 });

					await queue.add([{ type: "retry", id: "timer-b", rank: 40 }]);

					expect(await waiter.wait(0)).toEqual({ rank: 40 });
				}));

			test("an add behind the current earliest does not wake the waiter", () =>
				withQueueAndWaiter(async (queue, waiter) => {
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
				withQueueAndWaiter(async (queue, waiter) => {
					await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);
					expect(await waiter.wait(0)).toEqual({ rank: 10 });

					await queue.add([{ type: "retry", id: "timer-b", rank: 10 }]);

					expect(await waiter.wait(0.1)).toBeNull();
				}));

			test("a parked waiter wakes on a qualifying add", () =>
				withQueueAndWaiter(async (queue, waiter) => {
					await queue.add([{ type: "sleep", id: "timer-a", rank: 50 }]);
					expect(await waiter.wait(0)).toEqual({ rank: 50 });

					const waitPromise = waiter.wait(0);
					await queue.add([{ type: "retry", id: "timer-b", rank: 5 }]);

					expect(await waitPromise).toEqual({ rank: 5 });
				}));

			test("close resolves a parked wait with null", () =>
				withQueueAndWaiter(async (queue, waiter) => {
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
}
