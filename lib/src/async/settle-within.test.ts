import { settleWithin } from "./settle-within";
import { describe, expect, test } from "bun:test";

describe("settleWithin", () => {
	test("returns true when the promise settles within the budget", async () => {
		const settled = await settleWithin(Promise.resolve(), 1_000);
		expect(settled).toBe(true);
	});

	test("returns false when the timeout elapses first", async () => {
		let release: () => void = () => {};
		const promise = new Promise<void>((resolve) => {
			release = resolve;
		});
		const settled = await settleWithin(promise, 5);
		expect(settled).toBe(false);
		release();
	});

	test("treats a rejection as settled and swallows it", async () => {
		const settled = await settleWithin(Promise.reject(new Error("boom")), 1_000);
		expect(settled).toBe(true);
	});
});
