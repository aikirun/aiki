import { processImminentScheduledRuns } from "./imminent-scheduled-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedScheduledRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentScheduledRuns", () => {
	test("the outbox entry's rank carries the run's priority", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId } = await seedScheduledRun({ repos, namespaceRequestContext }, { options: { priority: 2 } });

				await processImminentScheduledRuns(
					context,
					{ repos },
					{ pageSize: 100, lookaheadWindowMs: 0, republishBackoff, chunk: { size: 100, maxConcurrency: 10 } }
				);

				const row = await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				});
				// computeRank(scheduledAt = now, priority 2) = 1_000_000 * 10 + 2.
				expect(row).toEqual(
					expect.objectContaining({
						workflowRunId: runId,
						status: "pending",
						rank: 10_000_002,
						nextPublishAttemptRank: 10_000_002,
					})
				);
			});
		}));
});
