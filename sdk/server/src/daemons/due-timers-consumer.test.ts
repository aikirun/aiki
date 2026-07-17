import { delay } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { createConsoleLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import { startDueTimersConsumer } from "./due-timers-consumer";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";

describe("startDueTimersConsumer", () => {
	test("resolves when the runtime signal aborts while parked in an indefinite wait", async () => {
		const abortController = new AbortController();
		const { signal } = abortController;
		const logger = createConsoleLogger({ level: "ERROR" });

		const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger, signal });
		const configProvider = asConfigProvider(() => ({ limit: 1, overshootMs: 10 }));

		let resolved = false;
		const consumer = startDueTimersConsumer(logger, {
			repos: {} as unknown as Repositories,
			signal,
			timerPriorityQueue,
			childRunCanceller: createChildRunCanceller(),
			configProvider,
		}).then(() => {
			resolved = true;
		});

		// Let the consumer reach the indefinite wait, then confirm it is genuinely parked.
		await delay(20);
		expect(resolved).toBe(false);

		abortController.abort();
		await consumer;

		expect(resolved).toBe(true);
	}, 2_000);
});
