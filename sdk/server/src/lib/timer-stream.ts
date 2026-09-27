import { streamChunks } from "@aikirun/lib/async";
import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { TimestampMs } from "@aikirun/lib/timestamp";

import { createKeysetStreamCursorAdvancer, type KeysetStreamCursor } from "./keyset-stream";
import { computeRank, type Ranked } from "../lib/rank";

interface Timer {
	dueAt: TimestampMs;
	id: string;
	options?: { priority?: number } | null;
}

const advanceTimerStreamCursor = createKeysetStreamCursorAdvancer<Timer>({
	getOrder: (timer) => timer.dueAt,
	getId: (timer) => timer.id,
});

export async function* streamTimers<Item extends Timer>(
	next: (cursor: KeysetStreamCursor | undefined) => Item[] | Promise<Item[]>,
	options?: {
		until?: (chunk: NonEmptyArray<Item>) => boolean;
	}
): AsyncGenerator<{ dueNow: Ranked<Item>[]; dueSoon: Ranked<Item>[] }> {
	let now = Date.now();

	for await (const { whenTrue, whenFalse } of streamChunks<Item, KeysetStreamCursor, Ranked<Item>, Ranked<Item>>(next, {
		advanceCursor: advanceTimerStreamCursor,
		until: options?.until,
		partition: (timer) => {
			const dueAt = timer.dueAt;
			return {
				meetsCondition: dueAt <= now,
				item: { ...timer, rank: computeRank({ dueAt, priority: timer.options?.priority }) },
			};
		},
	})) {
		yield { dueNow: whenTrue, dueSoon: whenFalse };
		now = Date.now();
	}
}
