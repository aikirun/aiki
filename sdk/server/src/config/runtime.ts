import { type } from "arktype";

const imminentPollingDaemonSchema = type({
	intervalMs: "number.integer > 0 = 1000",
	limit: "number.integer > 0 = 1000",
	imminenceThresholdMs: "number.integer > 0 = 3000",
}).default(() => ({}));

const daemonsSchema = type({
	imminentScheduledRuns: imminentPollingDaemonSchema,
	imminentSleepElapsedRuns: imminentPollingDaemonSchema,
	imminentRetryableRuns: imminentPollingDaemonSchema,
	imminentRetryableTaskRuns: imminentPollingDaemonSchema,
	imminentEventWaitTimedOutRuns: imminentPollingDaemonSchema,
	imminentChildRunWaitTimedOutRuns: imminentPollingDaemonSchema,
	imminentRecurringWorkflows: imminentPollingDaemonSchema,
	publishReadyRuns: type({
		intervalMs: "number.integer > 0 = 1000",
		limit: "number.integer > 0 = 1000",
	}).default(() => ({})),
	republishStaleRuns: type({
		intervalMs: "number.integer > 0 = 1000",
		limit: "number.integer > 0 = 1000",
		claimMinIdleTimeMs: "number.integer > 0 = 90000",
	}).default(() => ({})),
	dueTimersConsumer: type({
		limit: "number.integer > 0 = 1000",
		overshootMs: "number.integer >= 0 = 30",
	}).default(() => ({})),
}).default(() => ({}));

const serverConfigSchema = type({
	daemons: daemonsSchema,
	gracefulShutdownTimeoutMs: "number.integer >= 0 = 5000",
});

export type ServerConfig = typeof serverConfigSchema.infer;
export type ServerConfigOverrides = typeof serverConfigSchema.inferIn;

export function parseServerConfig(raw: unknown): ServerConfig {
	const result = serverConfigSchema(raw);
	if (result instanceof type.errors) {
		throw new Error(`Invalid server config: ${result.summary}`);
	}
	return result;
}
