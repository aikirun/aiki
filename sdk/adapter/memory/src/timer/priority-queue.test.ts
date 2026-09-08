import { noopLogger } from "@aikirun/lib/logger";
import { timerPriorityQueueTestSuite } from "@aikirun/testing/infra/timer";

import { inMemoryTimerPriorityQueue } from "./priority-queue";
import { describe, expect, test } from "bun:test";

timerPriorityQueueTestSuite({ describe, test, expect }, async (fn) => {
	const abortController = new AbortController();
	try {
		const queue = inMemoryTimerPriorityQueue()({ logger: noopLogger, signal: abortController.signal });
		await fn(queue);
	} finally {
		abortController.abort();
	}
});

describe("inMemoryTimerPriorityQueue clear", () => {
	test("clear drops every queued timer", async () => {
		const createTimerPriorityQueue = inMemoryTimerPriorityQueue();
		const queue = createTimerPriorityQueue({ logger: noopLogger });
		await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);

		createTimerPriorityQueue.clear();

		expect(await queue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([]);
	});

	test("clear leaves no pending wake for a later waiter", async () => {
		const createTimerPriorityQueue = inMemoryTimerPriorityQueue();
		const queue = createTimerPriorityQueue({ logger: noopLogger });
		await queue.add([{ type: "sleep", id: "timer-a", rank: 10 }]);

		createTimerPriorityQueue.clear();

		const waiter = queue.createWaiter();
		expect(await waiter.wait(0.05)).toBeNull();
		await waiter.close();
	});
});
