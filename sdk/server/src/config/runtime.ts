import type { DeepPartial } from "@aikirun/lib/object";
import { DEFAULT_CLAIM_IDLE_TIMEOUT_MS } from "@aikirun/types/workflow/run";

export interface PageProcessingConfig {
	pageSize: number;
	chunk: {
		size: number;
		maxConcurrency: number;
	};
}

interface PollingDaemonConfig extends PageProcessingConfig {
	intervalMs: number;
}

interface ImminentPollingDaemonConfig extends PollingDaemonConfig {
	lookaheadWindowMs: number;
}

export interface ServerRuntimeConfig {
	daemons: {
		imminentScheduledRuns: ImminentPollingDaemonConfig;
		imminentSleepElapsedRuns: ImminentPollingDaemonConfig;
		imminentRetryableRuns: ImminentPollingDaemonConfig;
		imminentTaskRetryableRuns: ImminentPollingDaemonConfig;
		imminentEventWaitTimedOutRuns: ImminentPollingDaemonConfig;
		imminentChildRunWaitTimedOutRuns: ImminentPollingDaemonConfig;
		imminentRecurringRuns: ImminentPollingDaemonConfig;
		publishPendingOutboxEntries: PollingDaemonConfig & {
			leaseDurationMs: number;
			republishBackoff: {
				baseDelayMs: number;
				maxDelayMs: number;
				declinedBackoffMs: number;
			};
		};
		recoverOverdueOutboxEntries: PollingDaemonConfig & {
			claimIdleTimeoutMs: number;
		};
		stallUndeliverableRuns: PollingDaemonConfig & {
			maxAgeMs: number;
		};
		dueTimersConsumer: {
			pageSize: number;
			overshootMs: number;
		};
	};
	gracefulShutdownTimeoutMs: number;
}

export type ServerRuntimeConfigOverrides = DeepPartial<ServerRuntimeConfig>;

export const defaultServerRuntimeConfig: ServerRuntimeConfig = {
	daemons: {
		imminentScheduledRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentSleepElapsedRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentRetryableRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentTaskRetryableRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentEventWaitTimedOutRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentChildRunWaitTimedOutRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		imminentRecurringRuns: {
			intervalMs: 10_000,
			pageSize: 1_000,
			lookaheadWindowMs: 30_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
		},
		publishPendingOutboxEntries: {
			intervalMs: 10_000,
			pageSize: 1_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
			leaseDurationMs: 5_000,
			republishBackoff: {
				baseDelayMs: 5_000,
				maxDelayMs: 300_000,
				declinedBackoffMs: 30_000,
			},
		},
		recoverOverdueOutboxEntries: {
			intervalMs: 10_000,
			pageSize: 1_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
			claimIdleTimeoutMs: DEFAULT_CLAIM_IDLE_TIMEOUT_MS,
		},
		stallUndeliverableRuns: {
			intervalMs: 60_000,
			pageSize: 1_000,
			chunk: {
				size: 100,
				maxConcurrency: 10,
			},
			maxAgeMs: 24 * 60 * 60 * 1_000, // 24 hours
		},
		dueTimersConsumer: {
			pageSize: 1_000,
			overshootMs: 30,
		},
	},
	gracefulShutdownTimeoutMs: 5_000,
};
