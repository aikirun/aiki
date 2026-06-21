import type { DeepPartial } from "@aikirun/lib/object";

interface PollingDaemonConfig {
	intervalMs: number;
	limit: number;
}

interface ImminentPollingDaemonConfig extends PollingDaemonConfig {
	imminenceThresholdMs: number;
}

export interface ServerRuntimeConfig {
	daemons: {
		imminentScheduledRuns: ImminentPollingDaemonConfig;
		imminentSleepElapsedRuns: ImminentPollingDaemonConfig;
		imminentRetryableRuns: ImminentPollingDaemonConfig;
		imminentRetryableTaskRuns: ImminentPollingDaemonConfig;
		imminentEventWaitTimedOutRuns: ImminentPollingDaemonConfig;
		imminentChildRunWaitTimedOutRuns: ImminentPollingDaemonConfig;
		imminentRecurringWorkflows: ImminentPollingDaemonConfig;
		publishReadyRuns: PollingDaemonConfig;
		republishStaleRuns: PollingDaemonConfig & {
			claimMinIdleTimeMs: number;
		};
		dueTimersConsumer: {
			limit: number;
			overshootMs: number;
		};
	};
	gracefulShutdownTimeoutMs: number;
}

export type ServerRuntimeConfigOverrides = DeepPartial<ServerRuntimeConfig>;

export const defaultServerRuntimeConfig: ServerRuntimeConfig = {
	daemons: {
		imminentScheduledRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentSleepElapsedRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentRetryableRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentRetryableTaskRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentEventWaitTimedOutRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentChildRunWaitTimedOutRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		imminentRecurringWorkflows: {
			intervalMs: 1_000,
			limit: 1_000,
			imminenceThresholdMs: 3_000,
		},
		publishReadyRuns: {
			intervalMs: 1_000,
			limit: 1_000,
		},
		republishStaleRuns: {
			intervalMs: 1_000,
			limit: 1_000,
			claimMinIdleTimeMs: 90_000,
		},
		dueTimersConsumer: {
			limit: 1_000,
			overshootMs: 30,
		},
	},
	gracefulShutdownTimeoutMs: 5_000,
};
