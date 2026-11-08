import { createBinaryLatch } from "@aikirun/lib/async";
import { noopLogger } from "@aikirun/lib/logger";
import { describe, expect, test } from "vitest";

import { dynamicRuntimeConfigProvider, staticRuntimeConfigProvider } from "./provider";
import type { ServerRuntimeConfigOverrides } from "./schema";

describe("staticRuntimeConfigProvider", () => {
	test("reads maxOccurrencesPerSchedule as maxOccurrencesCaughtUpPerSchedulePerPass", () => {
		const provider = staticRuntimeConfigProvider({
			daemons: { imminentRecurringRuns: { maxOccurrencesPerSchedule: 5 } },
		})({ logger: noopLogger, signal: AbortSignal.abort() });

		expect(provider.config.daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass).toBe(5);
	});
});

describe("dynamicRuntimeConfigProvider", () => {
	test("reads maxOccurrencesPerSchedule in initial as maxOccurrencesCaughtUpPerSchedulePerPass", () => {
		const provider = dynamicRuntimeConfigProvider({
			initial: { daemons: { imminentRecurringRuns: { maxOccurrencesPerSchedule: 5 } } },
			refresh: () => ({}),
			refreshIntervalMs: 60_000,
		})({ logger: noopLogger, signal: AbortSignal.abort() });

		expect(provider.config.daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass).toBe(5);
	});

	test("reads maxOccurrencesPerSchedule from refresh as maxOccurrencesCaughtUpPerSchedulePerPass, over its value in initial", async () => {
		const abortController = new AbortController();
		let refreshCount = 0;
		const refreshApplied = createBinaryLatch();

		const provider = dynamicRuntimeConfigProvider({
			initial: { daemons: { imminentRecurringRuns: { maxOccurrencesCaughtUpPerSchedulePerPass: 5 } } },
			refresh: () => {
				// The loop calls refresh again only after it applied the previous result.
				refreshCount++;
				if (refreshCount >= 2) {
					refreshApplied.signal();
				}
				return { daemons: { imminentRecurringRuns: { maxOccurrencesPerSchedule: 10 } } };
			},
			refreshIntervalMs: 1,
		})({ logger: noopLogger, signal: abortController.signal });

		await refreshApplied.wait();
		expect(provider.config.daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass).toBe(10);

		abortController.abort();
	});

	test("sets a config key back to its initial value once refresh stops returning it", async () => {
		const abortController = new AbortController();
		const refreshedOverrides: ServerRuntimeConfigOverrides[] = [{ gracefulShutdownTimeoutMs: 30_000 }, {}];
		let refreshCount = 0;
		const previousRefreshApplied = createBinaryLatch();
		const nextRefreshAllowed = createBinaryLatch();

		const provider = dynamicRuntimeConfigProvider({
			// Not the 5_000 default, so a refresh rebuilt from the defaults alone shows.
			initial: { gracefulShutdownTimeoutMs: 20_000 },
			refresh: async () => {
				// The loop calls refresh again only after it applied the previous result.
				if (refreshCount > 0) {
					previousRefreshApplied.signal();
					await nextRefreshAllowed.wait();
				}
				const overrides = refreshedOverrides[refreshCount] ?? {};
				refreshCount++;
				return overrides;
			},
			refreshIntervalMs: 1,
		})({ logger: noopLogger, signal: abortController.signal });

		await previousRefreshApplied.wait();
		expect(provider.config.gracefulShutdownTimeoutMs).toBe(30_000);

		nextRefreshAllowed.signal();
		await previousRefreshApplied.wait();
		expect(provider.config.gracefulShutdownTimeoutMs).toBe(20_000);

		abortController.abort();
		nextRefreshAllowed.signal();
	});
});
