/**
 * Default idle time before a claimed workflow run is considered abandoned and
 * eligible to be reclaimed by another worker.
 */
export const DEFAULT_CLAIM_MIN_IDLE_TIME_MS = 90_000;

/**
 * Interval at which a worker refreshes its claim on a run it is executing.
 *
 * Derived from {@link DEFAULT_CLAIM_MIN_IDLE_TIME_MS} so the keepalive stays
 * comfortably below the reclaim threshold (a claim survives two missed
 * heartbeats). Any reclaim threshold should remain greater than this interval,
 * otherwise a still-running claim could be stolen too early.
 */
export const CLAIM_KEEPALIVE_INTERVAL_MS = DEFAULT_CLAIM_MIN_IDLE_TIME_MS / 3;
