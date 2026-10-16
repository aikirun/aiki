import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { Logger } from "@aikirun/lib/logger";
import type { TimerEntry, TimerPriorityQueue } from "@aikirun/types/infra/timer";

import { computeMaxRank } from "../../lib/rank";

export async function addTimers(
	timerPriorityQueue: TimerPriorityQueue,
	params: { timers: NonEmptyArray<TimerEntry>; overshootMs: number },
	logger: Logger
): Promise<void> {
	const { timers, overshootMs } = params;
	const result = await timerPriorityQueue.add({
		timers,
		overdueRank: computeMaxRank({ dueBy: Date.now() - overshootMs }),
	});
	if (result.status === "failed") {
		logger.debug("Failed to add timers to priority queue", { "aiki.count": timers.length });
	}
}
