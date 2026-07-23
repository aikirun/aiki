import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";

import { computeRank, type Ranked } from "../lib/rank";

interface Timer {
	dueAt: TimestampMs;
	id: string;
}

export interface TimerStreamCursor {
	dueAt: TimestampMs;
	id: string;
	maxSeenId: string;
}

/**
 * Builds a function that updates the cursor as we walk a timer stream ordered by (dueAt, id).
 *
 * The cursor holds two things:
 * - `(dueAt, id)` — the frontier: where the last timer the walk settled on sits.
 * - `maxSeenId` — the largest id seen in any timer so far. The filter's third clause
 *   uses it to pick up timers that sort before the frontier but were inserted after
 *   the walk passed them.
 *
 * Timers arrive in (dueAt, id) order. When a timer sits at or after the frontier
 * (dueAt >= cursor.dueAt) it is the next step of the walk, so the frontier moves onto
 * it. A timer that sorts before the frontier can only be one of those late inserts, so
 * the frontier stays where it is and only maxSeenId grows. Moving the frontier backwards
 * would make the next query re-read a dueAt we finished.
 *
 * getDueAt/getId read those fields from whatever shape the caller's items have.
 */
export function createTimerStreamCursorAdvancer<Item>(options: {
	getDueAt: (item: Item) => TimestampMs;
	getId: (item: Item) => string;
}): (cursor: TimerStreamCursor | undefined, item: Item) => TimerStreamCursor {
	const { getDueAt, getId } = options;

	return (cursor, item) => {
		const dueAt = getDueAt(item);
		const id = getId(item);

		if (!cursor) {
			return { dueAt, id, maxSeenId: id };
		}

		const { maxSeenId: cursorMaxSeenId } = cursor;
		const maxSeenId = id > cursorMaxSeenId ? id : cursorMaxSeenId;

		if (dueAt >= cursor.dueAt) {
			return { dueAt, id, maxSeenId };
		} else {
			return { dueAt: cursor.dueAt, id: cursor.id, maxSeenId };
		}
	};
}

const advanceTimerStreamCursor = createTimerStreamCursorAdvancer<Timer>({
	getDueAt: (timer) => timer.dueAt,
	getId: (timer) => timer.id,
});

export async function* streamTimers<Item extends Timer>(
	next: (cursor: TimerStreamCursor | undefined) => Item[] | Promise<Item[]>,
	options?: {
		until?: (chunk: NonEmptyArray<Item>) => boolean;
	}
): AsyncGenerator<{ dueNow: Ranked<Item>[]; dueSoon: Ranked<Item>[] }> {
	let now = Date.now();

	for await (const { whenTrue, whenFalse } of streamChunks<Item, TimerStreamCursor, Ranked<Item>, Ranked<Item>>(next, {
		advanceCursor: advanceTimerStreamCursor,
		until: options?.until,
		partition: (timer) => {
			const dueAtMs = timer.dueAt;
			return { meetsCondition: dueAtMs <= now, item: { ...timer, rank: computeRank(dueAtMs) } };
		},
	})) {
		yield { dueNow: whenTrue, dueSoon: whenFalse };
		now = Date.now();
	}
}
