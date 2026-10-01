import { asConfigProvider } from "@aikirun/lib/config";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { describe, expect, test } from "vitest";

import { createImminentTimerQueue } from "./imminent-timer-queue";
import { computeRank } from "../../lib/rank";

function createQueues(lookaheadWindowMs: number) {
	const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
	return {
		timerPriorityQueue,
		imminentTimerQueue: createImminentTimerQueue({
			timerPriorityQueue,
			configProvider: asConfigProvider(() => ({ lookaheadWindowMs })),
			logger: noopLogger,
		}),
	};
}

describe("ImminentTimerQueue", () => {
	test("adds a timer of the run's type for a run due within the window", async () => {
		const { timerPriorityQueue, imminentTimerQueue } = createQueues(60_000);

		imminentTimerQueue.add([{ type: "sleep", id: "run-1", dueAt: 0, priority: undefined }]);

		expect(await timerPriorityQueue.popDue({ maxRank: computeRank({ dueAt: 0 }), limit: 10 })).toEqual([
			{ type: "sleep", id: "run-1", rank: computeRank({ dueAt: 0 }) },
		]);
	});

	test("mints the timer's rank with the run's priority", async () => {
		const { timerPriorityQueue, imminentTimerQueue } = createQueues(60_000);

		imminentTimerQueue.add([{ type: "sleep", id: "run-1", dueAt: 0, priority: 2 }]);

		expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
			{ type: "sleep", id: "run-1", rank: computeRank({ dueAt: 0, priority: 2 }) },
		]);
	});

	test("skips runs due beyond the window", async () => {
		const { timerPriorityQueue, imminentTimerQueue } = createQueues(60_000);

		imminentTimerQueue.add([
			{ type: "sleep", id: "run-due", dueAt: 0, priority: undefined },
			{ type: "sleep", id: "run-far", dueAt: Number.MAX_SAFE_INTEGER, priority: undefined },
		]);

		expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
			{ type: "sleep", id: "run-due", rank: computeRank({ dueAt: 0 }) },
		]);
	});
});
