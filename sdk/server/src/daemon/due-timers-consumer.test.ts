import { createBinaryLatch } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { startDueTimersConsumer } from "./due-timers-consumer";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";

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
		await timerPriorityQueue.add([{ type: "scheduled", id: "run-1", rank: 5 }]);
		const drainWaiter = timerPriorityQueue.createWaiter();
		expect(await drainWaiter.wait(0)).toEqual({ rank: 5 });
		await drainWaiter.close();

		const seenRunLookups: { ids: string[]; status: string }[] = [];
		const repos = {
			workflowRun: {
				listByIdsAndStatus: async (_context: unknown, ids: string[], status: string) => {
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
			})),
		});

		await processingReached.wait();
		abortController.abort();
		await consumer;

		expect(seenRunLookups).toEqual([{ ids: ["run-1"], status: "scheduled" }]);
		expect(await timerPriorityQueue.peekNext()).toBeNull();
	});
});
