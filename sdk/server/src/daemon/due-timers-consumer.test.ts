import { createBinaryLatch } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";
import { describe, expect, test } from "vitest";

import { startDueTimersConsumer } from "./due-timers-consumer";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";

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
	test("resolves when the runtime signal aborts while parked in an indefinite wait", async () => {
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
		const drainWaiter = timerPriorityQueue.createWaiter();
		expect(await drainWaiter.wait(0)).toEqual({ rank: 5 });
		await drainWaiter.close();

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
			const parkedIndefinitely = createBinaryLatch();
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
								parkedIndefinitely.signal();
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

			return { abortController, parkedIndefinitely, processingReached, seenRunLookups, stopped };
		};

		const consumerA = startConsumer();
		const consumerB = startConsumer();
		await consumerA.parkedIndefinitely.wait();
		await consumerB.parkedIndefinitely.wait();

		await timerPriorityQueue.add({ timers: [{ type: "scheduled", id: "run-1", rank: 5 }], overdueRank: 0 });
		await Promise.race([consumerA.stopped, consumerB.stopped]);
		expect(firstWokenAbortController).toBeDefined();
		const [stoppedConsumer, parkedConsumer] =
			firstWokenAbortController === consumerA.abortController ? [consumerA, consumerB] : [consumerB, consumerA];

		// The stopped consumer took the wake and nothing else: the timer is still queued.
		expect(stoppedConsumer.seenRunLookups).toEqual([]);
		expect(await timerPriorityQueue.peekNext()).toEqual({ rank: 5 });

		// run-1 is still the queue front, and its rank sits at the overdue rank.
		await timerPriorityQueue.add({ timers: [{ type: "scheduled", id: "run-2", rank: 6 }], overdueRank: 5 });

		// No time limit here: if nothing wakes the parked consumer, the test times out.
		while (parkedConsumer.seenRunLookups.flatMap((lookup) => lookup.ids).length < 2) {
			await parkedConsumer.processingReached.wait();
		}
		parkedConsumer.abortController.abort();
		await parkedConsumer.stopped;

		expect(parkedConsumer.seenRunLookups.flatMap((lookup) => lookup.ids).sort()).toEqual(["run-1", "run-2"]);
		expect(await timerPriorityQueue.peekNext()).toBeNull();
	});
});
