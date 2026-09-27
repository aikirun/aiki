import { createMinHeap } from "./min-heap";
import { describe, expect, test } from "bun:test";

const numericMinHeap = () => createMinHeap<number>((a, b) => a - b);

describe("createMinHeap", () => {
	test("starts empty", () => {
		const heap = numericMinHeap();
		expect(heap.size).toBe(0);
		expect(heap.peek()).toBeUndefined();
		expect(heap.popMin()).toBeUndefined();
	});

	test("peek returns the minimum element", () => {
		const heap = numericMinHeap();
		heap.push(3);
		heap.push(1);
		heap.push(2);
		expect(heap.peek()).toBe(1);
	});

	test("peek does not remove the element", () => {
		const heap = numericMinHeap();
		heap.push(5);
		heap.peek();
		expect(heap.size).toBe(1);
	});

	test("popMin returns elements in ascending order", () => {
		const heap = numericMinHeap();
		heap.push(5);
		heap.push(3);
		heap.push(8);
		heap.push(1);
		heap.push(4);

		const sorted = [];
		while (heap.size > 0) {
			sorted.push(heap.popMin());
		}
		expect(sorted).toEqual([1, 3, 4, 5, 8]);
	});

	test("tracks size correctly through push and pop", () => {
		const heap = numericMinHeap();
		heap.push(1);
		heap.push(2);
		expect(heap.size).toBe(2);
		heap.popMin();
		expect(heap.size).toBe(1);
		heap.popMin();
		expect(heap.size).toBe(0);
	});

	test("handles duplicate values", () => {
		const heap = numericMinHeap();
		heap.push(3);
		heap.push(3);
		heap.push(1);
		heap.push(1);
		expect(heap.popMin()).toBe(1);
		expect(heap.popMin()).toBe(1);
		expect(heap.popMin()).toBe(3);
		expect(heap.popMin()).toBe(3);
	});

	test("works with custom comparator", () => {
		const heap = createMinHeap<{ priority: number; name: string }>((a, b) => a.priority - b.priority);
		heap.push({ priority: 3, name: "low" });
		heap.push({ priority: 1, name: "high" });
		heap.push({ priority: 2, name: "medium" });

		expect(heap.popMin()?.name).toBe("high");
		expect(heap.popMin()?.name).toBe("medium");
		expect(heap.popMin()?.name).toBe("low");
	});

	test("maintains heap property after interleaved push and pop", () => {
		const heap = numericMinHeap();
		heap.push(5);
		heap.push(3);
		expect(heap.popMin()).toBe(3);
		heap.push(1);
		heap.push(4);
		expect(heap.popMin()).toBe(1);
		expect(heap.popMin()).toBe(4);
		expect(heap.popMin()).toBe(5);
	});
});
