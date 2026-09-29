import { createMutex } from "./mutex";
import { describe, expect, test } from "bun:test";

describe("createMutex", () => {
	test("acquire waits until the holder releases", async () => {
		const mutex = createMutex();
		const releaseFirst = await mutex.acquire();

		let secondAcquired = false;
		const secondHold = mutex.acquire().then((releaseSecond) => {
			secondAcquired = true;
			releaseSecond();
		});

		await Promise.resolve();
		expect(secondAcquired).toBe(false);

		releaseFirst();
		await secondHold;
		expect(secondAcquired).toBe(true);
	});

	test("holders are served in the order they acquired", async () => {
		const mutex = createMutex();
		const order: string[] = [];

		await Promise.all(
			["first", "second", "third"].map((label) =>
				mutex.runExclusive(async () => {
					order.push(`${label}:start`);
					await Promise.resolve();
					order.push(`${label}:end`);
				})
			)
		);

		expect(order).toEqual(["first:start", "first:end", "second:start", "second:end", "third:start", "third:end"]);
	});

	test("runExclusive releases when fn rejects", async () => {
		const mutex = createMutex();

		expect(
			mutex.runExclusive(async () => {
				throw new Error("boom");
			})
		).rejects.toThrow("boom");

		const release = await mutex.acquire();
		release();
	});

	test("releasing twice does not let two holders in", async () => {
		const mutex = createMutex();
		const release = await mutex.acquire();

		const secondHold = mutex.acquire();
		let thirdAcquired = false;
		const thirdHold = mutex.acquire().then((releaseThird) => {
			thirdAcquired = true;
			return releaseThird;
		});

		release();
		release();
		const releaseSecond = await secondHold;
		await Promise.resolve();
		expect(thirdAcquired).toBe(false);

		releaseSecond();
		(await thirdHold)();
	});
});
