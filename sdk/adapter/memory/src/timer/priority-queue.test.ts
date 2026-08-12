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
