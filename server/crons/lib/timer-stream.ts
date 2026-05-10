import type { NonEmptyArray } from "@aikirun/lib/array";
import { streamChunks } from "@aikirun/lib/async";

interface Timer {
	dueAt: Date;
	id: string;
}

export interface TimerStreamCursor {
	dueAt: Date;
	id: string;
	maxId: string;
}

export function createTimerStreamCursorAdvancer<Item>(options: {
	getDueAt: (item: Item) => Date;
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

		if (dueAt.getTime() >= cursor.dueAt.getTime()) {
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
	until?: (chunk: NonEmptyArray<Item>) => boolean
): AsyncGenerator<{ dueNow: Item[]; dueSoon: Item[] }> {
	const now = Date.now();
	for await (const { whenTrue, whenFalse } of streamChunks(next, {
		advanceCursor: advanceTimerStreamCursor,
		until,
		partition: (timer: Item) => timer.dueAt.getTime() <= now,
	})) {
		yield { dueNow: whenTrue, dueSoon: whenFalse };
	}
}
