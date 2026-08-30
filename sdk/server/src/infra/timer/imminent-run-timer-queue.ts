import { fireAndForget } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { computeRank } from "../../lib/rank";

export interface ImminentRunTimerQueueDeps {
	timerPriorityQueue: TimerPriorityQueue;
	configProvider: ConfigProvider<{ lookaheadWindowMs: number }>;
	logger: Logger;
}

export const createImminentRunTimerQueue = ({
	timerPriorityQueue,
	configProvider,
	logger,
}: ImminentRunTimerQueueDeps) => ({
	/**
	 * Adds a "scheduled" timer for each run due within the lookahead window, so
	 * the due-timers consumer picks the run up without waiting for the next
	 * promoter poll. Failures are logged and dropped: the poll is the backstop,
	 * so a missed timer costs latency, never the run.
	 */
	add(runs: NonEmptyArray<{ id: string; scheduledAt: number; priority: number | undefined }>): void {
		const dueBefore = Date.now() + configProvider.config.lookaheadWindowMs;
		const timers: TimerEntry[] = [];
		for (const { id, scheduledAt, priority } of runs) {
			if (scheduledAt <= dueBefore) {
				timers.push({ type: "scheduled", id, rank: computeRank({ dueAt: scheduledAt, priority }) });
			}
		}
		if (!isNonEmptyArray(timers)) {
			return;
		}

		fireAndForget(
			timerPriorityQueue.add(timers).then((result) => {
				if (result.status === "failed") {
					logger.debug("Failed to add imminent run timers", { "aiki.count": timers.length });
				}
			}),
			(err) => logger.debug("Failed to add imminent run timers", { err, "aiki.count": timers.length })
		);
	},
});

export type ImminentRunTimerQueue = ReturnType<typeof createImminentRunTimerQueue>;
