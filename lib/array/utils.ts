import type { NonEmptyArray } from "./types.ts";

export function groupBy<Item, Key, Value>(
	items: Item[],
	unwrap: (item: Item) => [Key, Value],
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

export function isNonEmptyArray<T>(value: T[]): value is NonEmptyArray<T> {
	return value.length > 0;
}

/**
 * Shuffles an array using Fisher-Yates algorithm for better randomness
 * @param array The array to shuffle
 * @returns A new shuffled array
 */
export function shuffleArray<T>(array: readonly T[]): T[] {
	const shuffledArray = Array.from(array);
	for (let i = shuffledArray.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffledArray[i], shuffledArray[j]] = [shuffledArray[j]!, shuffledArray[i]!];
	}
	return shuffledArray;
}

/**
 * Distributes a total size across an array of items using round-robin distribution
 * @param totalSize The total size to distribute
 * @param itemCount The number of items to distribute across
 * @returns Array of sizes for each item
 */
export function distributeRoundRobin(totalSize: number, itemCount: number): number[] {
	if (itemCount <= 0) return [];

	const distribution = Array(itemCount).fill(0);
	for (let i = 0; i < totalSize; i++) {
		distribution[i % itemCount]!++;
	}
	return distribution;
}
