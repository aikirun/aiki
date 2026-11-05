import { asConfigProvider } from "@aikirun/lib/config";
import { type Logger, noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { describe, expect, test, vi } from "vitest";

import { defaultServerRuntimeConfig } from "./config";
import { startRuntime } from "./runtime";
import { createDaemonHarness } from "./testing/harness";

const withHarness = createDaemonHarness();

describe("startRuntime", () => {
	test("warns that a deprecated key in a custom provider's config is ignored", () =>
		withHarness(async ({ db }) => {
			const warn = vi.fn();
			const logger: Logger = { ...noopLogger, warn, child: () => logger };
			const configWithDeprecatedKey = {
				...defaultServerRuntimeConfig,
				daemons: {
					...defaultServerRuntimeConfig.daemons,
					imminentRecurringRuns: {
						...defaultServerRuntimeConfig.daemons.imminentRecurringRuns,
						maxOccurrencesPerSchedule: 10,
					},
				},
			};

			const { daemonsPromise } = await startRuntime({
				db,
				logger,
				signal: AbortSignal.abort(),
				timerPriorityQueue: inMemoryTimerPriorityQueue(),
				config: () => asConfigProvider(() => configWithDeprecatedKey),
			});
			await daemonsPromise;

			expect(warn.mock.calls).toEqual([
				[
					"The config holds keys the server does not use, which are ignored",
					{ "aiki.configKeys": ["daemons.imminentRecurringRuns.maxOccurrencesPerSchedule"] },
				],
			]);
		}));
});
