import type { NonEmptyArray } from "./types";

export function groupBy<Item, Key, Value>(
	items: Item[],
	unwrap: (item: Item) => [Key, Value]
): Map<Key, NonEmptyArray<Value>> {
	const result = new Map<Key, NonEmptyArray<Value>>();
	for (const item of items) {
		const [key, value] = unwrap(item);
		const valuesWithSameKey = result.get(key);

		if (valuesWithSameKey === undefined) {
			result.set(key, [value]);
		} else {
			valuesWithSameKey.push(value);
		}
	}

	return result;
}

export function isNonEmptyArray<T>(value: T[] | undefined): value is NonEmptyArray<T> {
	return value !== undefined && value.length > 0;
}

export function* chunkLazy<T>(items: T[], size: number): Generator<NonEmptyArray<T>> {
	let sliceStart = 0;
	while (sliceStart < items.length) {
		yield items.slice(sliceStart, sliceStart + size) as NonEmptyArray<T>;
		sliceStart += size;
	}
}

export const partitionArray = <Item, WhenTrue = Item, WhenFalse = Item>(
	items: Item[],
	condition: (item: Item) => { meetsCondition: true; item: WhenTrue } | { meetsCondition: false; item: WhenFalse }
): { whenTrue: WhenTrue[]; whenFalse: WhenFalse[] } => {
	const itemsThatMeetCondition: WhenTrue[] = [];
	const itemsThatDoNotMeetCondition: WhenFalse[] = [];

	for (const item of items) {
		const result = condition(item);
		if (result.meetsCondition) {
			itemsThatMeetCondition.push(result.item);
		} else {
			itemsThatDoNotMeetCondition.push(result.item);
		}
	}

	return {
		whenTrue: itemsThatMeetCondition,
		whenFalse: itemsThatDoNotMeetCondition,
	};
};

/**
 * Shuffles an array using Fisher-Yates algorithm for better randomness
 * @param array The array to shuffle
 * @returns A new shuffled array
 */
export function shuffleArray<T>(array: readonly T[]): T[] {
	const shuffledArray = Array.from(array);
	for (let i = shuffledArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		// biome-ignore lint/style/noNonNullAssertion: index exists
		[shuffledArray[i], shuffledArray[j]] = [shuffledArray[j]!, shuffledArray[i]!];
	}
	return shuffledArray;
}
