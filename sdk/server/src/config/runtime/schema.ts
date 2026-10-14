import { MAX_TIMER_DELAY_MS } from "@aikirun/lib/async";
import type { ConfigValidationResult } from "@aikirun/lib/config";
import type { DeepPartial } from "@aikirun/lib/object";
import { type } from "arktype";

import { validateAgainstSchema } from "../validate";

const pageProcessingConfigSchema = type({
	pageSize: "number.integer > 0",
	chunk: {
		size: "number.integer > 0",
		maxConcurrency: "number.integer > 0",
	},
});

const pollingDaemonConfigSchema = pageProcessingConfigSchema.and({
	intervalMs: type("number.integer > 0").atMost(MAX_TIMER_DELAY_MS),
});

const imminentPollingDaemonConfigSchema = pollingDaemonConfigSchema.and({
	lookaheadWindowMs: "number.integer >= 0",
});

const serverRuntimeConfigSchema = type({
	daemons: {
		imminentScheduledRuns: imminentPollingDaemonConfigSchema,
		imminentSleepElapsedRuns: imminentPollingDaemonConfigSchema,
		imminentRetryableRuns: imminentPollingDaemonConfigSchema,
		imminentTaskRetryableRuns: imminentPollingDaemonConfigSchema,
		imminentEventWaitTimedOutRuns: imminentPollingDaemonConfigSchema,
		imminentChildRunWaitTimedOutRuns: imminentPollingDaemonConfigSchema,
		imminentRecurringRuns: imminentPollingDaemonConfigSchema.and({
			maxOccurrencesPerSchedule: "number.integer > 0",
		}),
		publishPendingOutboxEntries: pollingDaemonConfigSchema.and({
			leaseDurationMs: "number.integer > 0",
			republishBackoff: {
				baseDelayMs: "number.integer >= 0",
				maxDelayMs: "number.integer >= 0",
				declinedBackoffMs: "number.integer >= 0",
			},
		}),
		recoverOverdueOutboxEntries: pollingDaemonConfigSchema.and({
			claimIdleTimeoutMs: "number.integer > 0",
		}),
		stallUndeliverableRuns: pollingDaemonConfigSchema.and({
			maxAgeMs: "number.integer > 0",
		}),
		dueTimersConsumer: {
			pageSize: "number.integer > 0",
			overshootMs: "number.integer >= 0",
		},
	},
	gracefulShutdownTimeoutMs: type("number.integer >= 0").atMost(MAX_TIMER_DELAY_MS),
});

export type PageProcessingConfig = typeof pageProcessingConfigSchema.infer;

export type ServerRuntimeConfig = typeof serverRuntimeConfigSchema.infer;

export type ServerRuntimeConfigOverrides = DeepPartial<ServerRuntimeConfig>;

export function validateServerRuntimeConfig(config: ServerRuntimeConfig): ConfigValidationResult {
	return validateAgainstSchema(serverRuntimeConfigSchema, config);
}
