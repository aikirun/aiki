import { createBinaryLatch } from "./latch";
import { describe, expect, test } from "bun:test";

describe("createBinaryLatch", () => {
	test("wait blocks until signal is called", async () => {
		const latch = createBinaryLatch();

		let resolved = false;
		const waiting = latch.wait().then(() => {
			resolved = true;
		});

		expect(resolved).toBe(false);
		latch.signal();
		await waiting;
		expect(resolved).toBe(true);
	});

	test("signal before wait is buffered", async () => {
		const latch = createBinaryLatch();
		latch.signal();
		await latch.wait();
	});

	test("buffered signal serves one wait then resets to blocking", async () => {
		const latch = createBinaryLatch();
		latch.signal();
		await latch.wait();

		let resolved = false;
		const waiting = latch.wait().then(() => {
			resolved = true;
		});

		await Promise.resolve();
		expect(resolved).toBe(false);

		latch.signal();
		await waiting;
		expect(resolved).toBe(true);
	});

	test("multiple waiters share the same promise", async () => {
		const latch = createBinaryLatch();
		const promise1 = latch.wait();
		const promise2 = latch.wait();
		expect(promise1).toBe(promise2);
		latch.signal();
		await promise1;
	});

	test("multiple signals without waiters collapse into one buffered signal", async () => {
		const latch = createBinaryLatch();
		latch.signal();
		latch.signal();
		latch.signal();

		await latch.wait();

		let resolved = false;
		const waiting = latch.wait().then(() => {
			resolved = true;
		});

		await Promise.resolve();
		expect(resolved).toBe(false);

		latch.signal();
		await waiting;
		expect(resolved).toBe(true);
	});
});
