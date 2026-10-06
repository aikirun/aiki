import { fireAndForget } from "@aikirun/lib/async";
import { isNonEmptyArray, type NonEmptyArray } from "@aikirun/lib/collection/array";
import type { ConfigProvider } from "@aikirun/lib/config";
import type { Logger } from "@aikirun/lib/logger";
import type { TimerEntry, TimerPriorityQueue, TimerType } from "@aikirun/types/infra/timer";

import { computeRank } from "../../lib/rank";

interface Timer {
	type: TimerType;
	id: string;
	dueAt: number;
	priority: number | undefined;
}

export interface ImminentTimerQueueDeps {
	timerPriorityQueue: TimerPriorityQueue;
	configProvider: ConfigProvider<{ lookaheadWindowMs: number }>;
	logger: Logger;
}

export const createImminentTimerQueue = ({ timerPriorityQueue, configProvider, logger }: ImminentTimerQueueDeps) => ({
	/**
	 * Adds each timer due within the lookahead window, so the due-timers
	 * consumer picks it up without waiting for the next poll. Failures are
	 * logged and dropped: the poll is the backstop, so a missed timer costs
	 * latency, never the run or the schedule occurrence it stands for.
	 */
	add(timers: NonEmptyArray<Timer>): void {
		const dueBy = Date.now() + configProvider.config.lookaheadWindowMs;
		const imminentTimers: TimerEntry[] = [];
		for (const { type, id, dueAt, priority } of timers) {
			if (dueAt <= dueBy) {
				imminentTimers.push({ type, id, rank: computeRank({ dueAt, priority }) });
			}
		}
		if (!isNonEmptyArray(imminentTimers)) {
			return;
		}

		fireAndForget(
			timerPriorityQueue.add(imminentTimers).then((result) => {
				if (result.status === "failed") {
					logger.debug("Failed to add imminent timers", { "aiki.count": imminentTimers.length });
				}
			}),
			(err) => logger.debug("Failed to add imminent timers", { err, "aiki.count": imminentTimers.length })
		);
	},
});

export type ImminentTimerQueue = ReturnType<typeof createImminentTimerQueue>;
