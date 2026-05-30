import { isNonEmptyArray } from "../array";

export interface MinHeap<T> {
	readonly size: number;
	peek(): T | undefined;
	push(item: T): void;
	popMin(): T | undefined;
}

/**
 * Binary min-heap with a user-supplied comparator.
 *
 * `compare(a, b)` follows the standard contract: negative if `a` should come
 * before `b`, positive if after, zero if equal. The smallest item by the
 * comparator is always at the root.
 */
export function createMinHeap<T>(compare: (a: T, b: T) => number): MinHeap<T> {
	const items: T[] = [];

	function siftUp(start: number): void {
		let i = start;
		while (i > 0) {
			const parentIndex = (i - 1) >> 1;
			const current = items[i];
			const parent = items[parentIndex];
			if (current === undefined || parent === undefined) {
				return;
			}
			if (compare(current, parent) < 0) {
				items[i] = parent;
				items[parentIndex] = current;
				i = parentIndex;
			} else {
				return;
			}
		}
	}

	function siftDown(start: number): void {
		const n = items.length;
		let i = start;
		while (true) {
			const leftIndex = 2 * i + 1;
			const rightIndex = 2 * i + 2;
			const current = items[i];
			if (current === undefined) {
				return;
			}

			let smallestIndex = i;
			let smallest = current;

			if (leftIndex < n) {
				const left = items[leftIndex];
				if (left !== undefined && compare(left, smallest) < 0) {
					smallestIndex = leftIndex;
					smallest = left;
				}
			}
			if (rightIndex < n) {
				const right = items[rightIndex];
				if (right !== undefined && compare(right, smallest) < 0) {
					smallestIndex = rightIndex;
					smallest = right;
				}
			}

			if (smallestIndex === i) {
				return;
			}

			items[i] = smallest;
			items[smallestIndex] = current;
			i = smallestIndex;
		}
	}

	return {
		get size(): number {
			return items.length;
		},

		peek(): T | undefined {
			return items[0];
		},

		push(item: T): void {
			items.push(item);
			siftUp(items.length - 1);
		},

		popMin(): T | undefined {
			if (!isNonEmptyArray(items)) {
				return undefined;
			}

			const min = items[0];
			const last = items.pop();
			if (items.length === 0 || last === undefined) {
				return min;
			}
			items[0] = last;
			siftDown(0);
			return min;
		},
	};
}
