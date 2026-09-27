import { delay } from "./delay";
import { runOnInterval } from "./interval";
import { createBinaryLatch } from "./latch";
import { describe, expect, spyOn, test } from "bun:test";

describe("runOnInterval", () => {
	test("does not invoke fn synchronously", () => {
		let called = false;
		const { stop } = runOnInterval(
			async () => {
				called = true;
			},
			{ intervalMs: 1_000, onError: () => {} }
		);

		expect(called).toBe(false);
		stop();
	});

	test("invokes fn repeatedly on the interval", async () => {
		let calls = 0;
		const thirdCall = createBinaryLatch();

		const { stop } = runOnInterval(
			async () => {
				calls += 1;
				if (calls === 3) {
					thirdCall.signal();
				}
			},
			{ intervalMs: 1, onError: () => {} }
		);

		await thirdCall.wait();
		stop();
		expect(calls).toBeGreaterThanOrEqual(3);
	});

	test("stop prevents further invocations", async () => {
		let calls = 0;
		const firstCall = createBinaryLatch();

		const { stop } = runOnInterval(
			async () => {
				calls += 1;
				firstCall.signal();
			},
			{ intervalMs: 1, onError: () => {} }
		);

		await firstCall.wait();
		stop();
		const callsAtStop = calls;

		await delay(20);
		expect(calls).toBe(callsAtStop);
	});

	test("an already aborted signal prevents any invocations", async () => {
		const controller = new AbortController();
		controller.abort();

		let calls = 0;

		runOnInterval(
			async () => {
				calls += 1;
			},
			{ intervalMs: 1, onError: () => {}, signal: controller.signal }
		);

		await delay(20);
		expect(calls).toBe(0);
	});

	test("aborting the signal stops further invocations", async () => {
		const controller = new AbortController();
		let calls = 0;
		const firstCall = createBinaryLatch();

		runOnInterval(
			async () => {
				calls += 1;
				firstCall.signal();
			},
			{ intervalMs: 1, onError: () => {}, signal: controller.signal }
		);

		await firstCall.wait();
		controller.abort();
		const callsAtAbort = calls;

		await delay(20);
		expect(calls).toBe(callsAtAbort);
	});

	test("re-reads a function intervalMs on each tick", async () => {
		let reads = 0;
		let calls = 0;
		const secondCall = createBinaryLatch();

		const { stop } = runOnInterval(
			async () => {
				calls += 1;
				if (calls === 2) {
					secondCall.signal();
				}
			},
			{
				intervalMs: () => {
					reads += 1;
					return 1;
				},
				onError: () => {},
			}
		);

		await secondCall.wait();
		stop();
		expect(reads).toBeGreaterThanOrEqual(2);
	});

	test("routes fn rejections to onError and keeps running", async () => {
		const errors: Error[] = [];
		let calls = 0;
		const secondError = createBinaryLatch();

		const { stop } = runOnInterval(
			async () => {
				calls += 1;
				throw new Error(`boom ${calls}`);
			},
			{
				intervalMs: 1,
				onError: (err) => {
					errors.push(err);
					if (errors.length === 2) {
						secondError.signal();
					}
				},
			}
		);

		await secondError.wait();
		stop();
		expect(errors.length).toBeGreaterThanOrEqual(2);
		expect(errors[0]?.message).toBe("boom 1");
	});

	test("stop detaches the abort listener", () => {
		const controller = new AbortController();
		const removeListener = spyOn(controller.signal, "removeEventListener");

		const { stop } = runOnInterval(async () => {}, {
			intervalMs: 1_000,
			onError: () => {},
			signal: controller.signal,
		});
		stop();

		expect(removeListener).toHaveBeenCalledTimes(1);
	});
});
