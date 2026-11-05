import type { Logger } from "@aikirun/lib/logger";

import type { ServerRuntimeConfigOverrides } from "./schema";

/**
 * Takes deprecated keys out of `overrides`, warning about each one that is set.
 * A deprecated key's value moves to its replacement key.
 * It is dropped when the key has no replacement or the replacement is already set.
 */
export type ConfigDeprecation = (
	overrides: ServerRuntimeConfigOverrides,
	logger: Logger
) => ServerRuntimeConfigOverrides;

const renameMaxOccurrencesPerSchedule: ConfigDeprecation = (overrides, logger) => {
	const imminentRecurringRuns = overrides.daemons?.imminentRecurringRuns;
	if (imminentRecurringRuns?.maxOccurrencesPerSchedule === undefined) {
		return overrides;
	}

	const { maxOccurrencesPerSchedule, ...imminentRecurringRunsOverrides } = imminentRecurringRuns;
	const logMeta = {
		"aiki.deprecatedConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesPerSchedule",
		"aiki.replacementConfigKey": "daemons.imminentRecurringRuns.maxOccurrencesCaughtUpPerSchedulePerPass",
	};
	if (imminentRecurringRunsOverrides.maxOccurrencesCaughtUpPerSchedulePerPass === undefined) {
		logger.warn("A deprecated config key is set, and it will be removed in the next release", logMeta);
	} else {
		logger.warn("A deprecated config key is ignored because its replacement is set", logMeta);
	}

	return {
		...overrides,
		daemons: {
			...overrides.daemons,
			imminentRecurringRuns: {
				...imminentRecurringRunsOverrides,
				maxOccurrencesCaughtUpPerSchedulePerPass:
					imminentRecurringRunsOverrides.maxOccurrencesCaughtUpPerSchedulePerPass ?? maxOccurrencesPerSchedule,
			},
		},
	};
};

export const serverRuntimeConfigDeprecations: readonly ConfigDeprecation[] = [renameMaxOccurrencesPerSchedule];

/**
 * Migrates the deprecated keys in `overrides`, running each deprecation on what the previous one returned.
 *
 * Pass the overrides as the caller wrote them, so that a deprecated key can still set its replacement.
 * In a whole config every replacement has a value, at least its default, so each deprecated key is ignored.
 */
export function migrateDeprecatedConfigKeys(params: {
	overrides: ServerRuntimeConfigOverrides | undefined;
	deprecations: readonly ConfigDeprecation[];
	logger: Logger;
}): ServerRuntimeConfigOverrides | undefined {
	const { overrides, deprecations, logger } = params;
	if (overrides === undefined) {
		return overrides;
	}
	return deprecations.reduce(
		(migratedOverrides, migrateDeprecatedKey) => migrateDeprecatedKey(migratedOverrides, logger),
		overrides
	);
}
