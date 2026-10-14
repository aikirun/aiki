import { noopLogger } from "@aikirun/lib/logger";
import type { Database } from "@aikirun/types/infra/db";
import { describe, expect, test } from "vitest";

import { startRuntime } from "./runtime";

describe("startRuntime", () => {
	test("does not start when a setting is invalid", async () => {
		const starting = startRuntime({
			db: {} as Database,
			logger: noopLogger,
			signal: AbortSignal.abort(),
			config: { daemons: { recoverOverdueOutboxEntries: { claimIdleTimeoutMs: -5_000 } } },
		});

		await expect(starting).rejects.toThrow(
			/^Invalid config: daemons\.recoverOverdueOutboxEntries\.claimIdleTimeoutMs [^;]+$/
		);
	});
});
