import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import { processImminentTaskRetryableRuns } from "./imminent-task-retryable-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedAwaitingRetryTask, seedAwaitingTaskRetryRun } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build({});

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentTaskRetryableRuns", () => {
	test("a due awaiting_task_retry run is requeued with the rank carrying the run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingTaskRetryRun(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1 },
				{ options: { priority: 2 } }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{ pageSize: 100, lookaheadWindowMs: 0, republishBackoff, chunk: { size: 100, maxConcurrency: 10 } }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued" }),
					state: { status: "queued", reason: "task_retry" },
				})
			);

			const row = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: namespaceRequestContext.namespaceId,
				workflowRunId: runId,
			});
			// computeRank(nextAttemptAt = 1, priority 2) = 1 * 10 + 2 — the rank proves the scan
			// read the deadline the park stored on the run row.
			expect(row).toEqual(
				expect.objectContaining({ workflowRunId: runId, status: "pending", rank: 12, nextPublishAttemptRank: 12 })
			);
		}));

	test("a run due within the lookahead window mints a timer carrying the run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingTaskRetryRun(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1_030_000 },
				{ options: { priority: 2 } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// At now = 1_000_000 the run is not yet due, but its deadline sits inside the
			// 60_000ms lookahead window.
			await withFakeClock(1_000_000, () =>
				processImminentTaskRetryableRuns(
					context,
					{ repos, timerPriorityQueue },
					{ pageSize: 100, lookaheadWindowMs: 60_000, republishBackoff, chunk: { size: 100, maxConcurrency: 10 } }
				)
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "task_retry", id: runId, rank: computeRank({ dueAt: 1_030_000, priority: 2 }) },
			]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("a running run with a due awaiting_retry task is not requeued", () =>
		withHarness(async ({ context, repos, publisher }) => {
			// The task is due, but the run is still running, not awaiting_task_retry — only
			// parked runs are scanned.
			const { runId } = await seedAwaitingRetryTask(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1 }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{ pageSize: 100, lookaheadWindowMs: 0, republishBackoff, chunk: { size: 100, maxConcurrency: 10 } }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "running" }),
				})
			);
			// The delivery's claimed outbox row stays with the run until it parks.
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "claimed" }));
		}));
});
