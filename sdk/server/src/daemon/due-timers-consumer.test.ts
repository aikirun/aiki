import { createBinaryLatch } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";
import { describe, expect, test } from "vitest";

import { startDueTimersConsumer } from "./due-timers-consumer";
import type { Repositories } from "../infra/db/types";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";

const ONE_MINUTE_MS = 60 * 1_000;

const chunkConfig = { size: 100, maxConcurrency: 10 };
const chunkConfigByTimerType = {
	scheduled: chunkConfig,
	sleep: chunkConfig,
	retry: chunkConfig,
	task_retry: chunkConfig,
	event_wait_timeout: chunkConfig,
	child_wait_timeout: chunkConfig,
	recurring: chunkConfig,
};

describe("startDueTimersConsumer", () => {
	test("resolves when the runtime signal aborts while blocked in an indefinite wait", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const waitReached = createBinaryLatch();

		const realTimerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal });
		const timerPriorityQueue: TimerPriorityQueue = {
			...realTimerPriorityQueue,
			createWaiter: () => {
				const realWaiter = realTimerPriorityQueue.createWaiter();
				return {
					...realWaiter,
					wait: (timeoutSeconds: number) => {
						waitReached.signal();
						return realWaiter.wait(timeoutSeconds);
					},
				};
			},
		};

		let resolved = false;
		const consumer = startDueTimersConsumer(noopLogger, {
			repos: {} as unknown as Repositories,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider: asConfigProvider(() => ({
				pageSize: 1,
				overshootMs: 10,
				republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
				maxOccurrencesPerSchedule: 3,
				lookaheadWindowMs: 0,
				chunkByTimerType: chunkConfigByTimerType,
			})),
		}).then(() => {
			resolved = true;
		});

		await waitReached.wait();
		expect(resolved).toBe(false);

		abortController.abort();
		await consumer;

		expect(resolved).toBe(true);
	});

	test("the startup peek discovers timers left over from a previous consumer's lifecycle", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const processingReached = createBinaryLatch();

		const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal });
		await timerPriorityQueue.add({ timers: [{ type: "scheduled", id: "run-1", rank: 5 }], overdueRank: 0 });
		const previousWaiter = timerPriorityQueue.createWaiter();
		expect(await previousWaiter.wait(0)).toEqual({ rank: 5 });
		await previousWaiter.close();

		const seenRunLookups: { ids: string[]; status: string }[] = [];
		const repos = {
			workflowRun: {
				listDueByIdsAndStatus: async (_context: unknown, { ids, status }: { ids: string[]; status: string }) => {
					seenRunLookups.push({ ids, status });
					processingReached.signal();
					return [];
				},
			},
		} as unknown as Repositories;

		const consumer = startDueTimersConsumer(noopLogger, {
			repos,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider: asConfigProvider(() => ({
				pageSize: 1_000,
				overshootMs: 10,
				republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
				maxOccurrencesPerSchedule: 3,
				lookaheadWindowMs: 0,
				chunkByTimerType: chunkConfigByTimerType,
			})),
		});

		await processingReached.wait();
		abortController.abort();
		await consumer;

		expect(seenRunLookups).toEqual([{ ids: ["run-1"], status: "scheduled" }]);
		expect(await timerPriorityQueue.peekNext()).toBeNull();
	});

	test("a timer left in the queue by a stopped consumer is processed once another timer is added", async () => {
		const createTimerPriorityQueue = inMemoryTimerPriorityQueue();
		const timerPriorityQueue = createTimerPriorityQueue({ logger: noopLogger });

		let firstWokenAbortController: AbortController | undefined;

		const startConsumer = () => {
			const abortController = new AbortController();
			const { signal } = abortController;
			const waitingIndefinitely = createBinaryLatch();
			const processingReached = createBinaryLatch();

			const realTimerPriorityQueue = createTimerPriorityQueue({ logger: noopLogger, signal });
			const consumerTimerPriorityQueue: TimerPriorityQueue = {
				...realTimerPriorityQueue,
				createWaiter: () => {
					const realWaiter = realTimerPriorityQueue.createWaiter();
					return {
						...realWaiter,
						wait: async (timeoutSeconds: number) => {
							if (timeoutSeconds === 0) {
								waitingIndefinitely.signal();
							}
							const wake = await realWaiter.wait(timeoutSeconds);
							// Whichever consumer is woken first stops before it can act on the wake,
							// the way a crashed process would.
							if (wake !== null && firstWokenAbortController === undefined) {
								firstWokenAbortController = abortController;
								abortController.abort();
							}
							return wake;
						},
					};
				},
			};

			const seenRunLookups: { ids: string[]; status: string }[] = [];
			const repos = {
				workflowRun: {
					listDueByIdsAndStatus: async (_context: unknown, { ids, status }: { ids: string[]; status: string }) => {
						seenRunLookups.push({ ids, status });
						processingReached.signal();
						return [];
					},
				},
			} as unknown as Repositories;

			const stopped = startDueTimersConsumer(noopLogger, {
				repos,
				signal,
				timerPriorityQueue: consumerTimerPriorityQueue,
				childRunCanceller: createChildRunCanceller(),
				configProvider: asConfigProvider(() => ({
					pageSize: 1_000,
					overshootMs: 10,
					republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
					maxOccurrencesPerSchedule: 3,
					lookaheadWindowMs: 0,
					chunkByTimerType: chunkConfigByTimerType,
				})),
			});

			return { abortController, waitingIndefinitely, processingReached, seenRunLookups, stopped };
		};

		const consumerA = startConsumer();
		const consumerB = startConsumer();
		await consumerA.waitingIndefinitely.wait();
		await consumerB.waitingIndefinitely.wait();

		await timerPriorityQueue.add({ timers: [{ type: "scheduled", id: "run-1", rank: 5 }], overdueRank: 0 });
		await Promise.race([consumerA.stopped, consumerB.stopped]);
		expect(firstWokenAbortController).toBeDefined();
		const [stoppedConsumer, waitingConsumer] =
			firstWokenAbortController === consumerA.abortController ? [consumerA, consumerB] : [consumerB, consumerA];

		// The stopped consumer took the wake and nothing else: the timer is still queued.
		expect(stoppedConsumer.seenRunLookups).toEqual([]);
		expect(await timerPriorityQueue.peekNext()).toEqual({ rank: 5 });

		// run-1 is still the queue front, and its rank sits at the overdue rank.
		await timerPriorityQueue.add({ timers: [{ type: "scheduled", id: "run-2", rank: 6 }], overdueRank: 5 });

		// No time limit here: if nothing wakes the waiting consumer, the test times out.
		while (waitingConsumer.seenRunLookups.flatMap((lookup) => lookup.ids).length < 2) {
			await waitingConsumer.processingReached.wait();
		}
		waitingConsumer.abortController.abort();
		await waitingConsumer.stopped;

		expect(waitingConsumer.seenRunLookups.flatMap((lookup) => lookup.ids).sort()).toEqual(["run-1", "run-2"]);
		expect(await timerPriorityQueue.peekNext()).toBeNull();
	});

	test("waits until the next timer is due, plus the overshoot", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const waitReached = createBinaryLatch();
		const waitTimeoutsSeconds: number[] = [];

		const realTimerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal });
		const nextTimerDueAt = Date.UTC(3000, 0, 1);
		await realTimerPriorityQueue.add({
			timers: [{ type: "scheduled", id: "run-1", rank: computeRank({ dueAt: nextTimerDueAt }) }],
			overdueRank: 0,
		});
		// The add wakes a waiter. Here it wakes a previous consumer's, so the consumer under test finds the timer
		// through its startup peek.
		const previousWaiter = realTimerPriorityQueue.createWaiter();
		await previousWaiter.wait(0);
		await previousWaiter.close();
		const timerPriorityQueue: TimerPriorityQueue = {
			...realTimerPriorityQueue,
			createWaiter: () => {
				const realWaiter = realTimerPriorityQueue.createWaiter();
				return {
					...realWaiter,
					wait: (timeoutSeconds: number) => {
						waitTimeoutsSeconds.push(timeoutSeconds);
						waitReached.signal();
						return realWaiter.wait(timeoutSeconds);
					},
				};
			},
		};

		// Unit tests run concurrently and share one clock, so it cannot be frozen. The consumer reads it
		// somewhere between these two readings.
		const consumerStartedAt = Date.now();
		const consumer = startDueTimersConsumer(noopLogger, {
			repos: {} as unknown as Repositories,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider: asConfigProvider(() => ({
				pageSize: 1_000,
				overshootMs: ONE_MINUTE_MS,
				republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
				maxOccurrencesPerSchedule: 3,
				lookaheadWindowMs: 0,
				chunkByTimerType: chunkConfigByTimerType,
			})),
		});
		await waitReached.wait();
		const waitReachedAt = Date.now();

		abortController.abort();
		await consumer;

		const [waitTimeoutSeconds] = waitTimeoutsSeconds;
		expect(waitTimeoutSeconds).toBeGreaterThanOrEqual((nextTimerDueAt - waitReachedAt + ONE_MINUTE_MS) / 1_000);
		expect(waitTimeoutSeconds).toBeLessThanOrEqual((nextTimerDueAt - consumerStartedAt + ONE_MINUTE_MS) / 1_000);
	});

	test("a new timer due sooner than the one it waits for shortens the wait", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const waitReached = createBinaryLatch();
		const waitTimeoutsSeconds: number[] = [];

		const realTimerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal });
		await realTimerPriorityQueue.add({
			timers: [{ type: "scheduled", id: "run-1", rank: computeRank({ dueAt: Date.UTC(9999, 0, 1) }) }],
			overdueRank: 0,
		});
		// The add wakes a waiter. Here it wakes a previous consumer's, so the consumer under test finds the timer
		// through its startup peek.
		const previousWaiter = realTimerPriorityQueue.createWaiter();
		await previousWaiter.wait(0);
		await previousWaiter.close();
		const timerPriorityQueue: TimerPriorityQueue = {
			...realTimerPriorityQueue,
			createWaiter: () => {
				const realWaiter = realTimerPriorityQueue.createWaiter();
				return {
					...realWaiter,
					wait: (timeoutSeconds: number) => {
						waitTimeoutsSeconds.push(timeoutSeconds);
						waitReached.signal();
						return realWaiter.wait(timeoutSeconds);
					},
				};
			},
		};

		const consumer = startDueTimersConsumer(noopLogger, {
			repos: {} as unknown as Repositories,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider: asConfigProvider(() => ({
				pageSize: 1_000,
				overshootMs: ONE_MINUTE_MS,
				republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
				maxOccurrencesPerSchedule: 3,
				lookaheadWindowMs: 0,
				chunkByTimerType: chunkConfigByTimerType,
			})),
		});
		await waitReached.wait();

		// The clock cannot be frozen in a unit test, so the consumer's reading is bracketed.
		const soonerTimerAddedAt = Date.now();
		const soonerTimerDueAt = Date.UTC(3000, 0, 1);
		await realTimerPriorityQueue.add({
			timers: [{ type: "scheduled", id: "run-2", rank: computeRank({ dueAt: soonerTimerDueAt }) }],
			overdueRank: 0,
		});
		await waitReached.wait();
		const secondWaitReachedAt = Date.now();

		abortController.abort();
		await consumer;

		const [, secondWaitTimeoutSeconds] = waitTimeoutsSeconds;
		expect(secondWaitTimeoutSeconds).toBeGreaterThanOrEqual(
			(soonerTimerDueAt - secondWaitReachedAt + ONE_MINUTE_MS) / 1_000
		);
		expect(secondWaitTimeoutSeconds).toBeLessThanOrEqual(
			(soonerTimerDueAt - soonerTimerAddedAt + ONE_MINUTE_MS) / 1_000
		);
	});

	test("processes the next timer once the wait for it times out", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const processingReached = createBinaryLatch();

		const realTimerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal });
		await realTimerPriorityQueue.add({
			timers: [{ type: "scheduled", id: "run-1", rank: computeRank({ dueAt: 1 }) }],
			overdueRank: 0,
		});
		// The add wakes a waiter. Here it wakes a previous consumer's, so the consumer under test finds the timer
		// through its startup peek.
		const previousWaiter = realTimerPriorityQueue.createWaiter();
		await previousWaiter.wait(0);
		await previousWaiter.close();
		let waitTimedOut = false;
		const timerPriorityQueue: TimerPriorityQueue = {
			...realTimerPriorityQueue,
			createWaiter: () => {
				const realWaiter = realTimerPriorityQueue.createWaiter();
				return {
					...realWaiter,
					wait: async (timeoutSeconds: number) => {
						// Resolves the first wait that has a timeout with null, as its timeout would: the test cannot wait that long.
						if (timeoutSeconds > 0 && !waitTimedOut) {
							waitTimedOut = true;
							return null;
						}
						return realWaiter.wait(timeoutSeconds);
					},
				};
			},
		};

		const seenRunLookups: { ids: string[]; status: string }[] = [];
		const repos = {
			workflowRun: {
				listDueByIdsAndStatus: async (_context: unknown, { ids, status }: { ids: string[]; status: string }) => {
					seenRunLookups.push({ ids, status });
					processingReached.signal();
					return [];
				},
			},
		} as unknown as Repositories;

		const consumer = startDueTimersConsumer(noopLogger, {
			repos,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider: asConfigProvider(() => ({
				pageSize: 1_000,
				// The timer is overdue, but an overshoot larger than any clock reading still makes the consumer wait
				// for it before popping it.
				overshootMs: Number.MAX_SAFE_INTEGER,
				republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
				maxOccurrencesPerSchedule: 3,
				lookaheadWindowMs: 0,
				chunkByTimerType: chunkConfigByTimerType,
			})),
		});

		// No time limit here: if the consumer does not pop after the wait times out, the test times out.
		await processingReached.wait();
		abortController.abort();
		await consumer;

		expect(waitTimedOut).toBe(true);
		expect(seenRunLookups).toEqual([{ ids: ["run-1"], status: "scheduled" }]);
		expect(await timerPriorityQueue.peekNext()).toBeNull();
	});
});
