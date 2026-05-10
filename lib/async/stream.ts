import type { OptionalProp } from "@aikirun/types/property";

import { isNonEmptyArray, type NonEmptyArray } from "../array";

export interface StreamChunksOptions<Item, Cursor> {
	advanceCursor?: (current: Cursor | undefined, item: Item) => Cursor;
	until?: (chunk: NonEmptyArray<Item>) => boolean;
}

export interface StreamChunkPartitionsOptions<Item, Cursor> extends StreamChunksOptions<Item, Cursor> {
	partition: (item: Item) => boolean;
}

export function streamChunks<Item, Cursor>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: StreamChunksOptions<Item, Cursor>
): AsyncGenerator<NonEmptyArray<Item>>;
export function streamChunks<Item, Cursor>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: StreamChunkPartitionsOptions<Item, Cursor>
): AsyncGenerator<{ whenTrue: Item[]; whenFalse: Item[] }>;
export async function* streamChunks<Item, Cursor>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: OptionalProp<StreamChunkPartitionsOptions<Item, Cursor>, "partition">
): AsyncGenerator<NonEmptyArray<Item> | { whenTrue: Item[]; whenFalse: Item[] }> {
	let cursor: Cursor | undefined;
	const { advanceCursor, until, partition } = options;

	while (true) {
		const response = next(cursor);
		const chunk = response instanceof Promise ? await response : response;
		if (!isNonEmptyArray(chunk)) {
			return;
		}

		if (partition) {
			const whenTrue: Item[] = [];
			const whenFalse: Item[] = [];
			for (const item of chunk) {
				if (advanceCursor) {
					cursor = advanceCursor(cursor, item);
				}
				(partition(item) ? whenTrue : whenFalse).push(item);
			}
			yield { whenTrue, whenFalse };
		} else {
			if (advanceCursor) {
				for (const item of chunk) {
					cursor = advanceCursor(cursor, item);
				}
			}
			yield chunk;
		}

		if (until?.(chunk)) {
			return;
		}
	}
}
