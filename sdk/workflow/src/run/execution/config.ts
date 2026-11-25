export interface WorkflowExecutionConfig {
	/**
	 * Interval at which a worker refreshes its claim on a workflow run it is executing.
	 */
	claimRefreshIntervalMs: number;
	/**
	 * Longest wait the executor absorbs in process (default: 10ms).
	 *
	 * Delays <= maxInlineWaitMs: In-memory wait (fast, no task history entry)
	 * Delays > maxInlineWaitMs: Server state transition (recorded in task history)
	 *
	 * Set to 0 to record all task delays in transition history.
	 */
	maxInlineWaitMs: number;
}
