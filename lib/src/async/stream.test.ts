import { streamChunks } from "./stream";
import { describe, expect, test } from "bun:test";

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
	const results: T[] = [];
	for await (const item of generator) {
		results.push(item);
	}
	return results;
}

describe("streamChunks", () => {
	test("yields chunks until next returns empty", async () => {
		const batches = [[1, 2], [3, 4], []];
		let call = 0;
		const chunks = await collect(streamChunks(() => batches[call++] ?? [], {}));
		expect(chunks).toEqual([
			[1, 2],
			[3, 4],
		]);
	});

	test("yields nothing when first call returns empty", async () => {
		const chunks = await collect(streamChunks(() => [], {}));
		expect(chunks).toEqual([]);
	});

	test("works with async next function", async () => {
		const batches = [[1, 2], []];
		let call = 0;
		const chunks = await collect(streamChunks(async () => batches[call++] ?? [], {}));
		expect(chunks).toEqual([[1, 2]]);
	});

	test("advances cursor between calls", async () => {
		const cursors: (number | undefined)[] = [];
		const batches = [[1, 2, 3], [4, 5], []];
		let call = 0;

		await collect(
			streamChunks<number, number>(
				(cursor) => {
					cursors.push(cursor);
					return batches[call++] ?? [];
				},
				{ advanceCursor: (_, item) => item }
			)
		);

		expect(cursors).toEqual([undefined, 3, 5]);
	});

	test("stops early when until returns true", async () => {
		let call = 0;
		const chunks = await collect(
			streamChunks(
				() => {
					call++;
					return [call];
				},
				{ until: (chunk) => chunk[0] === 2 }
			)
		);

		expect(chunks).toEqual([[1], [2]]);
	});

	describe("partition mode", () => {
		test("splits each chunk into whenTrue and whenFalse", async () => {
			const batches = [[1, 2, 3, 4], []];
			let call = 0;

			const chunks = await collect(
				streamChunks(() => batches[call++] ?? [], {
					partition: (item) => ({ meetsCondition: item % 2 === 0, item }),
				})
			);

			expect(chunks).toEqual([{ whenTrue: [2, 4], whenFalse: [1, 3] }]);
		});

		test("transforms items during partition", async () => {
			const batches = [["hello", "ab", "world"], []];
			let call = 0;

			const chunks = await collect(
				streamChunks<string, undefined, string, number>(() => batches[call++] ?? [], {
					partition: (item) =>
						item.length > 3
							? { meetsCondition: true, item: item.toUpperCase() }
							: { meetsCondition: false, item: item.length },
				})
			);

			expect(chunks).toEqual([{ whenTrue: ["HELLO", "WORLD"], whenFalse: [2] }]);
		});

		test("advances cursor in partition mode", async () => {
			const cursors: (number | undefined)[] = [];
			const batches = [[1, 2], [3], []];
			let call = 0;

			await collect(
				streamChunks<number, number, number, number>(
					(cursor) => {
						cursors.push(cursor);
						return batches[call++] ?? [];
					},
					{
						advanceCursor: (_, item) => item,
						partition: (item: number) => ({ meetsCondition: true as const, item }),
					}
				)
			);

			expect(cursors).toEqual([undefined, 2, 3]);
		});
	});
});
