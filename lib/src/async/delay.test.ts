import { delay } from "./delay";
import { describe, expect, test } from "bun:test";

describe("delay", () => {
	test("does not resolve synchronously and resolves after the timer fires", async () => {
		let resolved = false;
		const promise = delay(10).then(() => {
			resolved = true;
		});

		// Resolution is deferred to the timer — nothing has run on this synchronous tick yet.
		expect(resolved).toBe(false);

		await promise;
		expect(resolved).toBe(true);
	});

	test("rejects immediately when abort signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort("cancelled");

		let reason: unknown;
		try {
			await delay(1_000, { signal: controller.signal });
		} catch (err) {
			reason = err;
		}
		expect(reason).toBe("cancelled");
	});

	test("rejects when abort signal fires during delay", async () => {
		const controller = new AbortController();
		const promise = delay(5_000, { signal: controller.signal });
		controller.abort("stopped");

		let reason: unknown;
		try {
			await promise;
		} catch (err) {
			reason = err;
		}
		expect(reason).toBe("stopped");
	});
});
