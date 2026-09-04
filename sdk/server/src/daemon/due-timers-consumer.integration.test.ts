import { asConfigProvider } from "@aikirun/lib/config";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import { processDueTimers } from "./due-timers-consumer";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedScheduledRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processDueTimers", () => {
	test("the timer's rank flows to the outbox entry unchanged", () =>
		withHarness(async ({ context, repos }) => {
			const now = 1_000_000;
			await withFakeClock(now, async () => {
				const { runId } = await seedScheduledRun({ repos, namespaceRequestContext }, { options: { priority: 2 } });

				await processDueTimers(
					context,
					{
						repos,
						signal: new AbortController().signal,
						timerPriorityQueue: inMemoryTimerPriorityQueue()({ logger: noopLogger }),
						childRunCanceller: createChildRunCanceller(),
						configProvider: asConfigProvider(() => ({ pageSize: 100, overshootMs: 0, republishBackoff })),
					},
					[{ type: "scheduled", id: runId, rank: computeRank({ dueAt: now, priority: 2 }) }]
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
