import { describe, expect, test } from "vitest";

import { defaultServerRuntimeConfig } from "./defaults";
import { findUndeclaredServerRuntimeConfigKeys, validateServerRuntimeConfig } from "./schema";

describe("validateServerRuntimeConfig", () => {
	test("accepts the defaults", () => {
		expect(validateServerRuntimeConfig(defaultServerRuntimeConfig)).toEqual({ valid: true });
	});
});

describe("findUndeclaredServerRuntimeConfigKeys", () => {
	test("finds each key the schema does not declare, at any depth", () => {
		const configWithUndeclaredKeys = {
			...defaultServerRuntimeConfig,
			daemons: {
				...defaultServerRuntimeConfig.daemons,
				imminentRecurringRuns: {
					...defaultServerRuntimeConfig.daemons.imminentRecurringRuns,
					maxOccurrencesPerSchedule: 10,
				},
			},
			gracefulShutdownTimoutMs: 10_000,
		};

		expect(findUndeclaredServerRuntimeConfigKeys(configWithUndeclaredKeys).sort()).toEqual([
			"daemons.imminentRecurringRuns.maxOccurrencesPerSchedule",
			"gracefulShutdownTimoutMs",
		]);
	});

	test("leaves out a declared key whose value is invalid", () => {
		const configWithInvalidValue = { ...defaultServerRuntimeConfig, gracefulShutdownTimeoutMs: -1 };

		expect(findUndeclaredServerRuntimeConfigKeys(configWithInvalidValue)).toEqual([]);
	});
});
