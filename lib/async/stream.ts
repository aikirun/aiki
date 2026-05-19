import { isNonEmptyArray, type NonEmptyArray } from "../array";
import type { OptionalProp } from "../object";

export interface StreamChunksOptions<Item, Cursor> {
	advanceCursor?: (current: Cursor | undefined, item: Item) => Cursor;
	until?: (chunk: NonEmptyArray<Item>) => boolean;
}

export interface StreamChunkPartitionsOptions<Item, Cursor, ItemWhenTrue = Item, ItemWhenFalse = Item>
	extends StreamChunksOptions<Item, Cursor> {
	partition: (
		item: Item
	) => { meetsCondition: true; item: ItemWhenTrue } | { meetsCondition: false; item: ItemWhenFalse };
}

export function streamChunks<Item, Cursor>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: StreamChunksOptions<Item, Cursor>
): AsyncGenerator<NonEmptyArray<Item>>;
export function streamChunks<Item, Cursor, ItemWhenTrue = Item, ItemWhenFalse = Item>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: StreamChunkPartitionsOptions<Item, Cursor, ItemWhenTrue, ItemWhenFalse>
): AsyncGenerator<{ whenTrue: ItemWhenTrue[]; whenFalse: ItemWhenFalse[] }>;
export async function* streamChunks<Item, Cursor, ItemWhenTrue = Item, ItemWhenFalse = Item>(
	next: (cursor?: Cursor) => Item[] | Promise<Item[]>,
	options: OptionalProp<StreamChunkPartitionsOptions<Item, Cursor, ItemWhenTrue, ItemWhenFalse>, "partition">
): AsyncGenerator<NonEmptyArray<Item> | { whenTrue: ItemWhenTrue[]; whenFalse: ItemWhenFalse[] }> {
	let cursor: Cursor | undefined;
	const { advanceCursor, until, partition } = options;

	while (true) {
		const response = next(cursor);
		const chunk = response instanceof Promise ? await response : response;
		if (!isNonEmptyArray(chunk)) {
			return;
		}

		if (partition) {
			const whenTrue: ItemWhenTrue[] = [];
			const whenFalse: ItemWhenFalse[] = [];
			for (const item of chunk) {
				if (advanceCursor) {
					cursor = advanceCursor(cursor, item);
				}
				const partitionResult = partition(item);
				if (partitionResult.meetsCondition) {
					whenTrue.push(partitionResult.item);
				} else {
					whenFalse.push(partitionResult.item);
				}
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
