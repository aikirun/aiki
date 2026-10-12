import { describe, expect, test, vi } from "vitest";

import { asConfigProvider, dynamicConfigProvider, validatedConfigProvider } from "./provider";
import type { ConfigValidationResult } from "./validation";
import { createBinaryLatch, delay } from "../async";
import { noopLogger } from "../logger";

describe("asConfigProvider", () => {
	test("config returns the read value", () => {
		const provider = asConfigProvider(() => ({ a: 1 }));
		expect(provider.config).toEqual({ a: 1 });
	});

	test("config reflects the latest value on each read", () => {
		let value = { a: 1 };
		const provider = asConfigProvider(() => value);
		expect(provider.config).toEqual({ a: 1 });
		value = { a: 2 };
		expect(provider.config).toEqual({ a: 2 });
	});

	test("config returns a stable reference when read returns a constant", () => {
		const value = { a: 1 };
		const provider = asConfigProvider(() => value);
		expect(provider.config).toBe(provider.config);
	});

	test("scope narrows to a sub-key", () => {
		const provider = asConfigProvider(() => ({ nested: { x: 10 }, top: 5 }));
		expect(provider.scope("nested").config).toEqual({ x: 10 });
	});

	test("scope is a live view of the parent", () => {
		let value = { nested: { x: 10 } };
		const provider = asConfigProvider(() => value);
		const nested = provider.scope("nested");
		expect(nested.config).toEqual({ x: 10 });
		value = { nested: { x: 20 } };
		expect(nested.config).toEqual({ x: 20 });
	});

	test("scope nests", () => {
		const provider = asConfigProvider(() => ({ a: { b: { c: 1 } } }));
		expect(provider.scope("a").scope("b").config).toEqual({ c: 1 });
	});
});

describe("dynamicConfigProvider", () => {
	test("starts on the initial value before any refresh completes", async () => {
		const logger = noopLogger;
		const abortController = new AbortController();

		let resolveRefresh: (value: { v: number }) => void = () => {};
		const refreshPromise = new Promise<{ v: number }>((resolve) => {
			resolveRefresh = resolve;
		});

		const provider = dynamicConfigProvider({
			initial: { v: 1 },
			refresh: () => refreshPromise,
			refreshIntervalMs: 10_000,
		})({ logger, signal: abortController.signal });

		expect(provider.config).toEqual({ v: 1 });

		abortController.abort();
		resolveRefresh({ v: 2 });
	});

	test("threads the current config into each refresh and advances it", async () => {
		const logger = noopLogger;
		const abortController = new AbortController();
		const seenConfigs: number[] = [];

		const twoRefreshesApplied = createBinaryLatch();

		dynamicConfigProvider({
			initial: { v: 0 },
			refresh: (current) => {
				seenConfigs.push(current.v);
				if (seenConfigs.length >= 2) {
					twoRefreshesApplied.signal();
				}
				return { v: current.v + 1 };
			},
			refreshIntervalMs: 1,
		})({ logger, signal: abortController.signal });

		await twoRefreshesApplied.wait();
		abortController.abort();

		expect(seenConfigs[0]).toBe(0);
		expect(seenConfigs[1]).toBe(1);
	});

	test("applies a successful refresh to the live snapshot", async () => {
		const logger = noopLogger;
		const abortController = new AbortController();

		const refreshApplied = createBinaryLatch();

		const provider = dynamicConfigProvider({
			initial: { v: 1 },
			refresh: (current) => {
				// Signal refreshApplied when the loop calls refresh again with the
				// applied value as `current` — proof that { v: 2 } was swapped into the snapshot.
				if (current.v === 2) {
					refreshApplied.signal();
				}
				return { v: 2 };
			},
			refreshIntervalMs: 1,
		})({ logger, signal: abortController.signal });

		await refreshApplied.wait();

		expect(provider.config).toEqual({ v: 2 });
		abortController.abort();
	});

	test("a failed refresh keeps the current snapshot and logs a warning", async () => {
		const logger = noopLogger;
		const abortController = new AbortController();

		const refreshFailed = createBinaryLatch();
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => refreshFailed.signal());

		const provider = dynamicConfigProvider({
			initial: { v: 1 },
			refresh: () => {
				throw new Error("boom");
			},
			refreshIntervalMs: 10_000,
		})({ logger, signal: abortController.signal });

		await refreshFailed.wait();

		expect(provider.config).toEqual({ v: 1 });
		expect(warnSpy.mock.calls.some(([message]) => message.includes("Config refresh failed"))).toBe(true);
		abortController.abort();
	});

	test("stops refreshing once the signal aborts", async () => {
		const logger = noopLogger;
		const abortController = new AbortController();

		const refreshIntervalMs = 1;
		let refreshCount = 0;

		// Signal once the loop has refreshed twice, so it is clearly running.
		const refreshLoopRunning = createBinaryLatch();

		dynamicConfigProvider({
			initial: { v: 0 },
			// Synchronous refresh function:
			// * so no event loop yield between abort signal check and refresh apply
			// * consequently, there can be no inflight refreshes on abort
			refresh: (current) => {
				refreshCount++;
				if (refreshCount >= 2) {
					refreshLoopRunning.signal();
				}
				return { v: current.v + 1 };
			},
			refreshIntervalMs,
		})({ logger, signal: abortController.signal });

		await refreshLoopRunning.wait();
		abortController.abort();

		const refreshCountAtAbort = refreshCount;
		// After abort, wait several intervals and confirm the count held steady
		await delay(refreshIntervalMs * 10);
		expect(refreshCount).toBe(refreshCountAtAbort);
	});
});

describe("validatedConfigProvider", () => {
	function validate(config: { polling: { intervalMs: number } }): ConfigValidationResult {
		if (config.polling.intervalMs <= 0) {
			return { valid: false, reason: "polling.intervalMs must be positive" };
		}
		return { valid: true };
	}

	const validationError = new Error("validation broke");

	function validateOrThrow(config: { polling: { intervalMs: number } }): ConfigValidationResult {
		if (config.polling.intervalMs <= 0) {
			throw validationError;
		}
		return { valid: true };
	}

	test("hands out the provider's config when it is valid", () => {
		const config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger: noopLogger,
		});
		expect(provider.config).toBe(config);
	});

	test("throws naming the reason when the provider's first config is invalid", () => {
		const config = { polling: { intervalMs: 0 } };
		expect(() =>
			validatedConfigProvider({
				provider: asConfigProvider(() => config),
				validate,
				logger: noopLogger,
			})
		).toThrow("Invalid config: polling.intervalMs must be positive");
	});

	test("throws an error with no cause when the provider's first config is rejected", () => {
		const config = { polling: { intervalMs: 0 } };

		let thrownError: unknown;
		try {
			validatedConfigProvider({
				provider: asConfigProvider(() => config),
				validate,
				logger: noopLogger,
			});
		} catch (err) {
			thrownError = err;
		}

		expect(thrownError).not.toHaveProperty("cause");
	});

	test("throws naming the error when the validation throws on the provider's first config", () => {
		const config = { polling: { intervalMs: 0 } };
		expect(() =>
			validatedConfigProvider({
				provider: asConfigProvider(() => config),
				validate: validateOrThrow,
				logger: noopLogger,
			})
		).toThrow("Invalid config: the validation threw Error: validation broke");
	});

	test("keeps the validation's own error as the cause when it throws on the provider's first config", () => {
		const config = { polling: { intervalMs: 0 } };

		let thrownError: unknown;
		try {
			validatedConfigProvider({
				provider: asConfigProvider(() => config),
				validate: validateOrThrow,
				logger: noopLogger,
			});
		} catch (err) {
			thrownError = err;
		}

		expect(thrownError).toHaveProperty("cause", validationError);
	});

	test("keeps handing out the last valid config when a later config is invalid", () => {
		const validConfig = { polling: { intervalMs: 1_000 } };
		let config = validConfig;
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger: noopLogger,
		});

		config = { polling: { intervalMs: 0 } };

		expect(provider.config).toBe(validConfig);
	});

	test("keeps handing out the last valid config while one invalid config follows another", () => {
		const validConfig = { polling: { intervalMs: 1_000 } };
		let config = validConfig;
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger: noopLogger,
		});

		config = { polling: { intervalMs: 0 } };
		expect(provider.config).toBe(validConfig);
		config = { polling: { intervalMs: -1 } };

		expect(provider.config).toBe(validConfig);
	});

	test("keeps handing out the last valid config when the validation throws on a later config", () => {
		const validConfig = { polling: { intervalMs: 1_000 } };
		let config = validConfig;
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate: validateOrThrow,
			logger: noopLogger,
		});

		config = { polling: { intervalMs: 0 } };

		expect(provider.config).toBe(validConfig);
	});

	test("hands out a later config again once it is valid", () => {
		let config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger: noopLogger,
		});

		config = { polling: { intervalMs: 0 } };
		expect(provider.config).toEqual({ polling: { intervalMs: 1_000 } });

		const recoveredConfig = { polling: { intervalMs: 2_000 } };
		config = recoveredConfig;

		expect(provider.config).toBe(recoveredConfig);
	});

	test("a scoped provider keeps handing out the last valid config too", () => {
		let config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger: noopLogger,
		});
		const pollingProvider = provider.scope("polling");

		config = { polling: { intervalMs: 0 } };

		expect(pollingProvider.config).toEqual({ intervalMs: 1_000 });
	});

	test("logs the reason once while the config stays invalid", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		let config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger,
		});

		config = { polling: { intervalMs: 0 } };
		provider.config;
		provider.config;
		config = { polling: { intervalMs: -1 } };
		provider.config;

		expect(logger.error.mock.calls).toEqual([
			["Config is invalid, keeping last-good", { "aiki.reason": "polling.intervalMs must be positive" }],
		]);
	});

	test("logs the validation's own error when it throws on a later config", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		let config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate: validateOrThrow,
			logger,
		});

		config = { polling: { intervalMs: 0 } };
		provider.config;

		expect(logger.error.mock.calls).toEqual([
			[
				"Config is invalid, keeping last-good",
				{ "aiki.reason": "the validation threw Error: validation broke", err: validationError },
			],
		]);
	});

	test("logs again when the config turns invalid after being valid", () => {
		const logger = { ...noopLogger, error: vi.fn() };
		let config = { polling: { intervalMs: 1_000 } };
		const provider = validatedConfigProvider({
			provider: asConfigProvider(() => config),
			validate,
			logger,
		});

		config = { polling: { intervalMs: 0 } };
		provider.config;
		config = { polling: { intervalMs: 2_000 } };
		provider.config;
		config = { polling: { intervalMs: 0 } };
		provider.config;

		expect(logger.error.mock.calls).toHaveLength(2);
	});
});
