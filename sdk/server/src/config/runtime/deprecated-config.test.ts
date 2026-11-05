import { noopLogger } from "@aikirun/lib/logger";
import { describe, expect, test, vi } from "vitest";

import {
	type ConfigDeprecation,
	migrateDeprecatedConfigKeys,
	serverRuntimeConfigDeprecations,
} from "./deprecated-config";

describe("migrateDeprecatedConfigKeys", () => {
	test("returns the overrides unchanged, without a warning, when no deprecated key is set", () => {
		const warn = vi.fn();
		const overrides = { daemons: { imminentRecurringRuns: { maxOccurrencesCaughtUpPerSchedulePerPass: 7 } } };

		const migratedOverrides = migrateDeprecatedConfigKeys({
			overrides,
			deprecations: serverRuntimeConfigDeprecations,
			logger: { ...noopLogger, warn },
		});

		expect(migratedOverrides).toBe(overrides);
		expect(warn.mock.calls).toEqual([]);
	});

	test("applies each deprecation to the overrides the previous one returned", () => {
		const setGracefulShutdownTimeout: ConfigDeprecation = (overrides) => ({
			...overrides,
			gracefulShutdownTimeoutMs: 10_000,
		});
		const setDueTimersPageSize: ConfigDeprecation = (overrides) => ({
			...overrides,
			daemons: { ...overrides.daemons, dueTimersConsumer: { pageSize: 50 } },
		});

		const migratedOverrides = migrateDeprecatedConfigKeys({
			overrides: {},
			deprecations: [setGracefulShutdownTimeout, setDueTimersPageSize],
			logger: noopLogger,
		});

		expect(migratedOverrides).toEqual({
			gracefulShutdownTimeoutMs: 10_000,
			daemons: { dueTimersConsumer: { pageSize: 50 } },
		});
	});

	test("moves maxOccurrencesPerSchedule to an unset maxOccurrencesCaughtUpPerSchedulePerPass, and warns that it will be removed", () => {
		const warn = vi.fn();

		const migratedOverrides = migrateDeprecatedConfigKeys({
			// A key beside the deprecated one at each level, so a level rebuilt without its other keys shows.
			overrides: {
				gracefulShutdownTimeoutMs: 10_000,
				daemons: {
					dueTimersConsumer: { pageSize: 50 },
					imminentRecurringRuns: { pageSize: 20, maxOccurrencesPerSchedule: 5 },
				},
			},
			deprecations: serverRuntimeConfigDeprecations,
			logger: { ...noopLogger, warn },
		});

		expect(migratedOverrides).toEqual({
			gracefulShutdownTimeoutMs: 10_000,
			daemons: {
				dueTimersConsumer: { pageSize: 50 },
				imminentRecurringRuns: { pageSize: 20, maxOccurrencesCaughtUpPerSchedulePerPass: 5 },
			},
		});
		expect(warn.mock.calls).toEqual([
			[
				"A deprecated config key is set, and it will be removed in the next release",
				{
					"aiki.deprecatedConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesPerSchedule",
					"aiki.replacementConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass",
				},
			],
		]);
	});

	test("drops maxOccurrencesPerSchedule when maxOccurrencesCaughtUpPerSchedulePerPass is set, and warns that it was ignored", () => {
		const warn = vi.fn();

		const migratedOverrides = migrateDeprecatedConfigKeys({
			overrides: {
				daemons: {
					imminentRecurringRuns: { maxOccurrencesPerSchedule: 5, maxOccurrencesCaughtUpPerSchedulePerPass: 7 },
				},
			},
			deprecations: serverRuntimeConfigDeprecations,
			logger: { ...noopLogger, warn },
		});

		expect(migratedOverrides).toEqual({
			daemons: { imminentRecurringRuns: { maxOccurrencesCaughtUpPerSchedulePerPass: 7 } },
		});
		expect(warn.mock.calls).toEqual([
			[
				"A deprecated config key is ignored because its replacement is set",
				{
					"aiki.deprecatedConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesPerSchedule",
					"aiki.replacementConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass",
				},
			],
		]);
	});

	test("leaves the caller's overrides untouched", () => {
		const overrides = { daemons: { imminentRecurringRuns: { maxOccurrencesPerSchedule: 5 } } };

		migrateDeprecatedConfigKeys({ overrides, deprecations: serverRuntimeConfigDeprecations, logger: noopLogger });

		expect(overrides).toEqual({ daemons: { imminentRecurringRuns: { maxOccurrencesPerSchedule: 5 } } });
	});
});
