import { createBinaryLatch } from "@aikirun/lib/async";
import { noopLogger } from "@aikirun/lib/logger";

import { runConcurrently } from "./concurrency";
import { describe, expect, test } from "bun:test";
import { createDaemonContext } from "../middleware/context";

const context = (signal = new AbortController().signal) =>
	createDaemonContext({ name: "test", logger: noopLogger, signal });

const gatedItem = (name: string) => ({ name, started: createBinaryLatch(), release: createBinaryLatch() });

describe("runConcurrently", () => {
	test("holds an item back until a running one finishes", async () => {
		const first = gatedItem("first");
		const second = gatedItem("second");
		const third = gatedItem("third");
		const startedNames: string[] = [];

		const run = runConcurrently(
			context(),
			[first, second, third],
			async (item) => {
				startedNames.push(item.name);
				item.started.signal();
				await item.release.wait();
			},
			{ concurrency: 2 }
		);

		await second.started.wait();
		expect(startedNames).toEqual(["first", "second"]);

		first.release.signal();
		await third.started.wait();
		expect(startedNames).toEqual(["first", "second", "third"]);

		second.release.signal();
		third.release.signal();
		await run;
	});

	test("stops taking new items once the context is aborted", async () => {
		const abortController = new AbortController();
		const itemStarted = createBinaryLatch();
		const releaseItem = createBinaryLatch();
		const startedItems: number[] = [];

		const run = runConcurrently(
			context(abortController.signal),
			[1, 2, 3],
			async (item) => {
				startedItems.push(item);
				itemStarted.signal();
				await releaseItem.wait();
			},
			{ concurrency: 1 }
		);

		await itemStarted.wait();
		abortController.abort();
		releaseItem.signal();
		await run;

		expect(startedItems).toEqual([1]);
	});

	test("consumes a lazy iterable", async () => {
		function* countUpToThree() {
			yield 1;
			yield 2;
			yield 3;
		}
		const startedItems: number[] = [];

		await runConcurrently(context(), countUpToThree(), async (item) => {
			startedItems.push(item);
		});

		expect(startedItems.sort((left, right) => left - right)).toEqual([1, 2, 3]);
	});

	test("runs every item even when one of them throws", async () => {
		const startedItems: number[] = [];

		expect(
			runConcurrently(
				context(),
				[1, 2, 3],
				async (item) => {
					startedItems.push(item);
					if (item === 2) {
						throw new Error("boom");
					}
				},
				{ concurrency: 1 }
			)
		).rejects.toThrow("boom");

		expect(startedItems).toEqual([1, 2, 3]);
	});

	test("stops at the first failure when failFast is set", async () => {
		const startedItems: number[] = [];

		expect(
			runConcurrently(
				context(),
				[1, 2, 3],
				async (item) => {
					startedItems.push(item);
					throw new Error(`boom ${item}`);
				},
				{ concurrency: 1, failFast: true }
			)
		).rejects.toThrow("boom 1");

		expect(startedItems).toEqual([1]);
	});
});
