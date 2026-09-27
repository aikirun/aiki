import { fireAndForget } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { TimerEntry, TimerPriorityQueue, TimerType } from "@aikirun/types/infra/timer";

import { computeRank } from "../../lib/rank";

interface ImminentRunTimer {
	type: TimerType;
	id: string;
	dueAt: number;
	priority: number | undefined;
}

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
	 * Adds a timer for each run due within the lookahead window, so the
	 * due-timers consumer picks the run up without waiting for the next
	 * promoter poll. Failures are logged and dropped: the poll is the backstop,
	 * so a missed timer costs latency, never the run.
	 */
	add(runs: NonEmptyArray<ImminentRunTimer>): void {
		const dueBefore = Date.now() + configProvider.config.lookaheadWindowMs;
		const timers: TimerEntry[] = [];
		for (const { type, id, dueAt, priority } of runs) {
			if (dueAt <= dueBefore) {
				timers.push({ type, id, rank: computeRank({ dueAt, priority }) });
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
