import { createBinaryLatch } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { type Logger, noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import type { Publisher } from "@aikirun/types/infra/queue";
import type { TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { processDueTimers } from "./due-timers-consumer";
import { processImminentChildRunWaitTimedOutRuns } from "./imminent-child-run-wait-timed-out-runs";
import { processImminentEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { processImminentRecurringRuns } from "./imminent-recurring-runs";
import { processImminentRetryableRuns } from "./imminent-retryable-runs";
import { processImminentRetryableTasks } from "./imminent-retryable-tasks";
import { processImminentScheduledRuns } from "./imminent-scheduled-runs";
import { processImminentSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import { pollingDaemon, startDaemons } from "./index";
import { publishPendingOutboxEntries } from "./publish-pending-outbox-entries";
import { recoverOverdueOutboxEntries } from "./recover-overdue-outbox-entries";
import { stallUndeliverableRuns } from "./stall-undeliverable-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config";
import type { Repositories } from "../infra/db/types";
import type { DaemonContext } from "../middleware/context";
import { createChildRunCanceller } from "../service/cancel-child-runs";

describe("pollingDaemon", () => {
	interface TestDaemonConfig {
		intervalMs: number;
		label?: string;
	}

	function startPollingLoop<Deps>(
		signal: AbortSignal,
		getConfig: () => TestDaemonConfig,
		fn: (context: DaemonContext, deps: Deps, config: TestDaemonConfig) => Promise<void>,
		deps: Deps
	): Promise<void> {
		const { start } = pollingDaemon(noopLogger, signal, asConfigProvider(getConfig));
		return start(fn, deps, (config) => config);
	}

	test("ticks repeatedly until the signal aborts", async () => {
		const abortController = new AbortController();
		const thirdTickReached = createBinaryLatch();
		let tickCount = 0;

		const loop = startPollingLoop(
			abortController.signal,
			() => ({ intervalMs: 0 }),
			async () => {
				tickCount++;
				if (tickCount === 3) {
					thirdTickReached.signal();
				}
			},
			{}
		);

		await thirdTickReached.wait();
		abortController.abort();
		await loop;

		expect(tickCount).toBeGreaterThanOrEqual(3);
	});

	test("passes the selected config and deps through to the tick", async () => {
		const abortController = new AbortController();
		const firstTickReached = createBinaryLatch();
		const deps = { flavor: "vanilla" };
		const seenCalls: { deps: { flavor: string }; config: TestDaemonConfig }[] = [];

		const loop = startPollingLoop(
			abortController.signal,
			() => ({ intervalMs: 3_600_000, label: "passthrough" }),
			async (_context, tickDeps, config) => {
				seenCalls.push({ deps: tickDeps, config });
				firstTickReached.signal();
			},
			deps
		);

		await firstTickReached.wait();
		abortController.abort();
		await loop;

		expect(seenCalls).toEqual([{ deps, config: { intervalMs: 3_600_000, label: "passthrough" } }]);
		expect(seenCalls[0]?.deps).toBe(deps);
	});

	test("reads config fresh on every tick", async () => {
		const abortController = new AbortController();
		const initialTickReached = createBinaryLatch();
		const updatedTickReached = createBinaryLatch();
		let label = "initial";
		const seenLabels: (string | undefined)[] = [];

		const loop = startPollingLoop(
			abortController.signal,
			() => ({ intervalMs: 0, label }),
			async (_context, _deps, config) => {
				seenLabels.push(config.label);
				if (config.label === "initial") {
					initialTickReached.signal();
				}
				if (config.label === "updated") {
					updatedTickReached.signal();
				}
			},
			{}
		);

		await initialTickReached.wait();
		label = "updated";
		await updatedTickReached.wait();
		abortController.abort();
		await loop;

		expect(Array.from(new Set(seenLabels))).toEqual(["initial", "updated"]);
	});

	test("keeps ticking after a tick that throws", async () => {
		const abortController = new AbortController();
		const recoveredTickReached = createBinaryLatch();
		let tickCount = 0;

		const loop = startPollingLoop(
			abortController.signal,
			() => ({ intervalMs: 0 }),
			async () => {
				tickCount++;
				if (tickCount === 1) {
					throw new Error("tick failure");
				}
				recoveredTickReached.signal();
			},
			{}
		);

		await recoveredTickReached.wait();
		abortController.abort();
		await loop;

		expect(tickCount).toBeGreaterThanOrEqual(2);
	}, 5_000);

	test("resolves promptly when aborted while parked in the inter-tick delay", async () => {
		const abortController = new AbortController();
		const firstTickReached = createBinaryLatch();
		let tickCount = 0;

		const loop = startPollingLoop(
			abortController.signal,
			() => ({ intervalMs: 3_600_000 }),
			async () => {
				tickCount++;
				firstTickReached.signal();
			},
			{}
		);

		await firstTickReached.wait();
		abortController.abort();
		await loop;

		expect(tickCount).toBe(1);
	});
});

describe("startDaemons", () => {
	function startTestDaemons(
		signal: AbortSignal,
		logger: Logger,
		extraDeps?: { publisher?: Publisher; timerPriorityQueue?: TimerPriorityQueue }
	): Promise<void> {
		return startDaemons(logger, {
			repos: {} as unknown as Repositories,
			signal,
			configProvider: asConfigProvider(() => defaultServerRuntimeConfig),
			childRunCanceller: createChildRunCanceller(),
			...extraDeps,
		});
	}

	// Daemons name their context on each tick via logger.child({ "aiki.daemonName" }),
	// so the child bindings are where mounted daemons become observable.
	function createDaemonNameRecordingLogger(
		seenDaemonNames: string[],
		onDaemonName?: (daemonName: string) => void
	): Logger {
		const logger: Logger = {
			...noopLogger,
			child: (bindings) => {
				const daemonName = bindings["aiki.daemonName"];
				if (typeof daemonName === "string") {
					seenDaemonNames.push(daemonName);
					onDaemonName?.(daemonName);
				}
				return logger;
			},
		};
		return logger;
	}

	const baseDaemonNames = [
		processImminentScheduledRuns.name,
		processImminentSleepElapsedRuns.name,
		processImminentRetryableRuns.name,
		processImminentRetryableTasks.name,
		processImminentEventWaitTimedOutRuns.name,
		processImminentChildRunWaitTimedOutRuns.name,
		processImminentRecurringRuns.name,
		recoverOverdueOutboxEntries.name,
		stallUndeliverableRuns.name,
	];

	test("mounts every polling daemon on start", async () => {
		const abortController = new AbortController();
		const seenDaemonNames: string[] = [];

		const daemons = startTestDaemons(abortController.signal, createDaemonNameRecordingLogger(seenDaemonNames));

		expect(seenDaemonNames).toEqual(baseDaemonNames);

		abortController.abort();
		await daemons;
	});

	test("mounts the outbox publisher daemon when a publisher is provided", async () => {
		const abortController = new AbortController();
		const seenDaemonNames: string[] = [];

		const daemons = startTestDaemons(abortController.signal, createDaemonNameRecordingLogger(seenDaemonNames), {
			publisher: {} as unknown as Publisher,
		});

		expect(seenDaemonNames).toEqual(baseDaemonNames.concat(publishPendingOutboxEntries.name));

		abortController.abort();
		await daemons;
	});

	test("mounts the due-timers consumer when a timer priority queue is provided", async () => {
		const abortController = new AbortController();
		const consumerWoken = createBinaryLatch();
		const seenDaemonNames: string[] = [];

		const logger = createDaemonNameRecordingLogger(seenDaemonNames, (daemonName) => {
			if (daemonName === processDueTimers.name) {
				consumerWoken.signal();
			}
		});
		const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger, signal: abortController.signal });

		const daemons = startTestDaemons(abortController.signal, logger, { timerPriorityQueue });

		// dueAt 0 wakes the consumer immediately.
		await timerPriorityQueue.add([{ type: "scheduled", id: "timer-1", dueAt: 0, rank: 0 }]);
		await consumerWoken.wait();

		abortController.abort();
		await daemons;

		expect(seenDaemonNames).toEqual(baseDaemonNames.concat(processDueTimers.name));
	});

	test("resolves when the signal aborts", async () => {
		const abortController = new AbortController();

		const daemons = startTestDaemons(abortController.signal, noopLogger);

		abortController.abort();
		await daemons;
	}, 2_000);
});
