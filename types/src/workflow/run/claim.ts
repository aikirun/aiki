/**
 * Default idle time after which the server considers a claimed workflow run
 * abandoned and makes it claimable again by other workers.
 */
export const DEFAULT_CLAIM_MIN_IDLE_TIME_MS = 90_000;

/**
 * Interval at which a worker refreshes its claim on a run it is executing.
 *
 * Derived from {@link DEFAULT_CLAIM_MIN_IDLE_TIME_MS} so the interval stays
 * comfortably below the abandonment threshold: an active claim survives a
 * couple of missed refreshes.
 */
export const CLAIM_REFRESH_INTERVAL_MS = DEFAULT_CLAIM_MIN_IDLE_TIME_MS / 3;
