import { delay } from "./delay";
import { describe, expect, test } from "bun:test";

describe("delay", () => {
	test("resolves after the specified duration", async () => {
		const start = performance.now();
		await delay(50);
		const elapsed = performance.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(50);
	});

	test("rejects immediately when abort signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort("cancelled");
		expect(delay(1000, { abortSignal: controller.signal })).rejects.toBe("cancelled");
	});

	test("rejects when abort signal fires during delay", async () => {
		const controller = new AbortController();
		const promise = delay(5000, { abortSignal: controller.signal });
		controller.abort("stopped");
		expect(promise).rejects.toBe("stopped");
	});
});
