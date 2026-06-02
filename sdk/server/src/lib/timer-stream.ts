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
	maxId: string;
}

export function createTimerStreamCursorAdvancer<Item>(options: {
	getDueAt: (item: Item) => TimestampMs;
	getId: (item: Item) => string;
}): (cursor: TimerStreamCursor | undefined, item: Item) => TimerStreamCursor {
	const { getDueAt, getId } = options;

	return (cursor, item) => {
		const dueAt = getDueAt(item);
		const id = getId(item);

		if (!cursor) {
			return { dueAt, id, maxId: id };
		}

		const { maxId: cursorMaxId } = cursor;
		const maxId = id > cursorMaxId ? id : cursorMaxId;

		if (dueAt >= cursor.dueAt) {
			return { dueAt, id, maxId };
		} else {
			return { dueAt: cursor.dueAt, id: cursor.id, maxId };
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
			const rank = computeRank(dueAtMs);
			return { meetsCondition: dueAtMs <= now, item: { ...timer, rank } };
		},
	})) {
		yield { dueNow: whenTrue, dueSoon: whenFalse };
		now = Date.now();
	}
}
