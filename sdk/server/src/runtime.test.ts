import { noopLogger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import { describe, expect, test } from "vitest";

import { startRuntime } from "./runtime";

describe("startRuntime", () => {
	test("does not start when the config holds a NaN", async () => {
		const starting = startRuntime({
			db: {} as Database,
			logger: noopLogger,
			signal: AbortSignal.abort(),
			config: { daemons: { recoverOverdueOutboxEntries: { claimIdleTimeoutMs: Number.NaN } } },
		});

		await expect(starting).rejects.toThrow("daemons.recoverOverdueOutboxEntries.claimIdleTimeoutMs is NaN");
	});
});
