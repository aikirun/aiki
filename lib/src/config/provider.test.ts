import { asConfigProvider, dynamicConfigProvider } from "./provider";
import { describe, expect, spyOn, test } from "bun:test";
import { delay } from "../async";
import { createConsoleLogger } from "../logger";

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
		const logger = createConsoleLogger({ level: "ERROR" });
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
		const logger = createConsoleLogger({ level: "ERROR" });
		const abortController = new AbortController();
		const seenConfigs: number[] = [];

		let resolveTwoRefreshesApplied: () => void = () => {};
		const twoRefreshesAppliedPromise = new Promise<void>((resolve) => {
			resolveTwoRefreshesApplied = resolve;
		});

		dynamicConfigProvider({
			initial: { v: 0 },
			refresh: (current) => {
				seenConfigs.push(current.v);
				if (seenConfigs.length >= 2) {
					resolveTwoRefreshesApplied();
				}
				return { v: current.v + 1 };
			},
			refreshIntervalMs: 1,
		})({ logger, signal: abortController.signal });

		await twoRefreshesAppliedPromise;
		abortController.abort();

		expect(seenConfigs[0]).toBe(0);
		expect(seenConfigs[1]).toBe(1);
	});

	test("applies a successful refresh to the live snapshot", async () => {
		const logger = createConsoleLogger({ level: "ERROR" });
		const abortController = new AbortController();

		let resolveRefreshApplied: () => void = () => {};
		const refreshAppliedPromise = new Promise<void>((resolve) => {
			resolveRefreshApplied = resolve;
		});

		const provider = dynamicConfigProvider({
			initial: { v: 1 },
			refresh: (current) => {
				// Resolve refreshAppliedPromise when the loop calls refresh again with the
				// applied value as `current` — proof that { v: 2 } was swapped into the snapshot.
				if (current.v === 2) {
					resolveRefreshApplied();
				}
				return { v: 2 };
			},
			refreshIntervalMs: 1,
		})({ logger, signal: abortController.signal });

		await refreshAppliedPromise;

		expect(provider.config).toEqual({ v: 2 });
		abortController.abort();
	});

	test("a failed refresh keeps the current snapshot and logs a warning", async () => {
		const logger = createConsoleLogger({ level: "ERROR" });
		const abortController = new AbortController();

		let resolveRefreshFailed: () => void = () => {};
		const refreshFailedPromise = new Promise<void>((resolve) => {
			resolveRefreshFailed = resolve;
		});
		const warnSpy = spyOn(logger, "warn").mockImplementation(() => resolveRefreshFailed());

		const provider = dynamicConfigProvider({
			initial: { v: 1 },
			refresh: () => {
				throw new Error("boom");
			},
			refreshIntervalMs: 10_000,
		})({ logger, signal: abortController.signal });

		await refreshFailedPromise;

		expect(provider.config).toEqual({ v: 1 });
		expect(warnSpy.mock.calls.some(([message]) => message.includes("Config refresh failed"))).toBe(true);
		abortController.abort();
	});

	test("stops refreshing once the signal aborts", async () => {
		const logger = createConsoleLogger({ level: "ERROR" });
		const abortController = new AbortController();

		const refreshIntervalMs = 1;
		let refreshCount = 0;

		// Resolve once the loop has refreshed twice, so it is clearly running.
		let resolveRefreshLoopRunning: () => void = () => {};
		const refreshLoopRunningPromise = new Promise<void>((resolve) => {
			resolveRefreshLoopRunning = resolve;
		});

		dynamicConfigProvider({
			initial: { v: 0 },
			// Synchronous refresh function:
			// * so no event loop yield between abort signal check and refresh apply
			// * consequently, there can be no inflight refreshes on abort
			refresh: (current) => {
				refreshCount++;
				if (refreshCount >= 2) {
					resolveRefreshLoopRunning();
				}
				return { v: current.v + 1 };
			},
			refreshIntervalMs,
		})({ logger, signal: abortController.signal });

		await refreshLoopRunningPromise;
		abortController.abort();

		const refreshCountAtAbort = refreshCount;
		// After abort, wait several intervals and confirm the count held steady
		await delay(refreshIntervalMs * 10);
		expect(refreshCount).toBe(refreshCountAtAbort);
	});
});
