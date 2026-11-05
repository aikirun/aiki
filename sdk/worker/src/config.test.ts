import { createBinaryLatch } from "@aikirun/lib/async";
import { noopLogger } from "@aikirun/lib/logger";
import { describe, expect, test } from "vitest";

import { dynamicWorkerConfigProvider, type WorkerConfigOverrides } from "./config";

describe("dynamicWorkerConfigProvider", () => {
	test("sets a setting back to its initial value once refresh stops returning it", async () => {
		const abortController = new AbortController();
		const refreshedOverrides: WorkerConfigOverrides[] = [{ maxConcurrentWorkflowRuns: 10 }, {}];
		let refreshCount = 0;
		const previousRefreshApplied = createBinaryLatch();
		const nextRefreshAllowed = createBinaryLatch();

		const provider = dynamicWorkerConfigProvider({
			// Not the default of 1, so a refresh rebuilt from the defaults alone shows.
			initial: { maxConcurrentWorkflowRuns: 5 },
			refresh: async () => {
				// The loop calls refresh again only after it applied the previous result.
				if (refreshCount > 0) {
					previousRefreshApplied.signal();
					await nextRefreshAllowed.wait();
				}
				const overrides = refreshedOverrides[refreshCount] ?? {};
				refreshCount++;
				return overrides;
			},
			refreshIntervalMs: 1,
		})({ logger: noopLogger, signal: abortController.signal });

		await previousRefreshApplied.wait();
		expect(provider.config.maxConcurrentWorkflowRuns).toBe(10);

		nextRefreshAllowed.signal();
		await previousRefreshApplied.wait();
		expect(provider.config.maxConcurrentWorkflowRuns).toBe(5);

		abortController.abort();
		nextRefreshAllowed.signal();
	});
});
