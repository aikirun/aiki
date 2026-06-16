import { getRetryParams, withRetry } from "./strategy";
import { describe, expect, spyOn, test } from "bun:test";

describe("getRetryParams", () => {
	describe("never strategy", () => {
		test("returns no retries left", () => {
			expect(getRetryParams(1, { type: "never" })).toEqual({ retriesLeft: false });
		});

		test("returns no retries left regardless of attempt count", () => {
			expect(getRetryParams(100, { type: "never" })).toEqual({ retriesLeft: false });
		});
	});

	describe("fixed strategy", () => {
		const strategy = { type: "fixed" as const, maxAttempts: 3, delayMs: 1000 };

		test("retries with configured delay when under max attempts", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
		});

		test("returns same delay on every attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 1000 });
		});

		test("stops retrying at max attempts", () => {
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: false });
		});

		test("stops retrying beyond max attempts", () => {
			expect(getRetryParams(5, strategy)).toEqual({ retriesLeft: false });
		});
	});

	describe("exponential strategy", () => {
		const strategy = { type: "exponential" as const, maxAttempts: 5, baseDelayMs: 100 };

		test("uses base delay on first attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
		});

		test("doubles (default factor) delay on each attempt", () => {
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: true, delayMs: 400 });
		});

		test("uses custom factor", () => {
			const customFactorStrategy = { ...strategy, factor: 3 };
			expect(getRetryParams(1, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
			expect(getRetryParams(3, customFactorStrategy)).toEqual({ retriesLeft: true, delayMs: 900 });
		});

		test("caps delay at maxDelayMs", () => {
			const cappedDelayStrategy = { ...strategy, maxDelayMs: 300 };
			expect(getRetryParams(1, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(2, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			expect(getRetryParams(3, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
			expect(getRetryParams(4, cappedDelayStrategy)).toEqual({ retriesLeft: true, delayMs: 300 });
		});

		test("stops retrying at max attempts", () => {
			expect(getRetryParams(5, strategy)).toEqual({ retriesLeft: false });
		});
	});

	describe("jittered strategy", () => {
		const strategy = { type: "jittered" as const, maxAttempts: 5, baseDelayMs: 100 };

		test("returns delay between 0 and base on first attempt", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 50 });
			mock.mockRestore();
		});

		test("scales jitter with attempt number using default factor", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			expect(getRetryParams(1, strategy)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(2, strategy)).toEqual({ retriesLeft: true, delayMs: 100 });
			expect(getRetryParams(3, strategy)).toEqual({ retriesLeft: true, delayMs: 200 });
			mock.mockRestore();
		});

		test("uses custom factor", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.5);
			const customFactor = { ...strategy, factor: 3 };
			expect(getRetryParams(1, customFactor)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(2, customFactor)).toEqual({ retriesLeft: true, delayMs: 150 });
			expect(getRetryParams(3, customFactor)).toEqual({ retriesLeft: true, delayMs: 450 });
			mock.mockRestore();
		});

		test("returns 0 delay when random returns 0", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0);
			const result = getRetryParams(1, strategy);
			expect(result).toEqual({ retriesLeft: true, delayMs: 0 });
			mock.mockRestore();
		});

		test("caps delay at maxDelayMs", () => {
			const mock = spyOn(Math, "random").mockReturnValue(0.9);
			const capped = { ...strategy, maxDelayMs: 50 };
			expect(getRetryParams(1, capped)).toEqual({ retriesLeft: true, delayMs: 50 });
			expect(getRetryParams(3, capped)).toEqual({ retriesLeft: true, delayMs: 50 });
			mock.mockRestore();
		});

		test("stops retrying at max attempts", () => {
			const result = getRetryParams(5, strategy);
			expect(result).toEqual({ retriesLeft: false });
		});
	});
});

describe("withRetry", () => {
	const strategy = { type: "fixed" as const, maxAttempts: 3, delayMs: 0 };

	test("returns completed on first success", async () => {
		const result = await withRetry(async () => "ok", strategy).run();
		expect(result).toEqual({ state: "completed", result: "ok", attempts: 1 });
	});

	test("passes arguments through to the function", async () => {
		const result = await withRetry(async (value: string) => value.toUpperCase(), strategy).run("hello");
		expect(result).toEqual({ state: "completed", result: "HELLO", attempts: 1 });
	});

	test("retries on error and returns completed when function succeeds", async () => {
		let calls = 0;
		const result = await withRetry(async () => {
			calls++;
			if (calls < 3) {
				throw new Error("fail");
			}
			return "recovered";
		}, strategy).run();

		expect(result).toEqual({ state: "completed", result: "recovered", attempts: 3 });
	});

	test("returns timeout when retries are exhausted", async () => {
		const result = await withRetry(async () => {
			throw new Error("always fails");
		}, strategy).run();

		expect(result).toEqual({ state: "timeout" });
	});

	describe("shouldRetryOnResult", () => {
		test("retries when callback returns true", async () => {
			let calls = 0;
			const result = await withRetry(
				async () => {
					calls++;
					return calls;
				},
				strategy,
				{ shouldRetryOnResult: (result) => result < 3 }
			).run();

			expect(result).toEqual({ state: "completed", result: 3, attempts: 3 });
		});

		test("completes when callback returns false", async () => {
			const result = await withRetry(async () => "good", strategy, {
				shouldRetryOnResult: () => false,
			}).run();

			expect(result).toEqual({ state: "completed", result: "good", attempts: 1 });
		});

		test("supports async callback", async () => {
			let calls = 0;
			const result = await withRetry(
				async () => {
					calls++;
					return calls;
				},
				strategy,
				{ shouldRetryOnResult: async (result) => result < 2 }
			).run();

			expect(result).toEqual({ state: "completed", result: 2, attempts: 2 });
		});

		test("returns timeout when result never satisfies", async () => {
			const result = await withRetry(async () => "bad", strategy, {
				shouldRetryOnResult: () => true,
			}).run();

			expect(result).toEqual({ state: "timeout" });
		});
	});

	describe("shouldNotRetryOnError", () => {
		test("re-throws when callback returns true", async () => {
			const err = new Error("fatal");
			expect(
				withRetry(
					async () => {
						throw err;
					},
					strategy,
					{ shouldNotRetryOnError: () => true }
				).run()
			).rejects.toThrow(err);
		});

		test("continues retrying when callback returns false", async () => {
			const result = await withRetry(
				async () => {
					throw new Error("transient");
				},
				strategy,
				{ shouldNotRetryOnError: () => false }
			).run();

			expect(result).toEqual({ state: "timeout" });
		});

		test("supports async callback", async () => {
			const fatal = new Error("fatal");
			expect(
				withRetry(
					async () => {
						throw fatal;
					},
					strategy,
					{ shouldNotRetryOnError: async () => true }
				).run()
			).rejects.toThrow(fatal);
		});
	});

	describe("onError", () => {
		test("is called on each failed attempt", async () => {
			const errors: unknown[] = [];
			await withRetry(
				async () => {
					throw new Error("boom");
				},
				strategy,
				{
					onError: (err) => {
						errors.push(err);
					},
				}
			).run();

			expect(errors).toHaveLength(3);
			for (const error of errors) {
				expect(error).toBeInstanceOf(Error);
			}
		});

		test("supports async callback", async () => {
			const errors: unknown[] = [];
			await withRetry(
				async () => {
					throw new Error("boom");
				},
				strategy,
				{
					onError: async (err) => {
						errors.push(err);
					},
				}
			).run();

			expect(errors).toHaveLength(3);
			for (const error of errors) {
				expect(error).toBeInstanceOf(Error);
			}
		});

		test("is not called on success", async () => {
			const errors: unknown[] = [];
			await withRetry(async () => "ok", strategy, {
				onError: (err) => {
					errors.push(err);
				},
			}).run();

			expect(errors).toHaveLength(0);
		});
	});

	describe("abort signal", () => {
		test("returns aborted immediately when signal is already aborted", async () => {
			const controller = new AbortController();
			controller.abort("cancelled");

			const result = await withRetry(async () => "ok", strategy, {
				abortSignal: controller.signal,
			}).run();

			expect(result).toEqual({ state: "aborted", reason: "cancelled" });
		});

		test("returns aborted when signal fires between attempts", async () => {
			const controller = new AbortController();
			let calls = 0;

			const result = await withRetry(
				async () => {
					calls++;
					if (calls === 1) {
						controller.abort("stopped");
					}
					throw new Error("fail");
				},
				strategy,
				{ abortSignal: controller.signal }
			).run();

			expect(result).toEqual({ state: "aborted", reason: "stopped" });
			expect(calls).toBe(1);
		});
	});
});
