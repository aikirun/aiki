import { createConsoleLogger, noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import { processImminentRetryableTasks } from "./imminent-retryable-tasks";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedAwaitingRetryTask } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build({ logger: createConsoleLogger() });

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentRetryableTasks", () => {
	test("a due retryable task promotes its run to queued with the rank carrying the run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingRetryTask(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1 },
				{ options: { priority: 2 } }
			);

			await processImminentRetryableTasks(context, { repos }, { limit: 100, lookaheadWindowMs: 0, republishBackoff });

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
			// computeRank(nextAttemptAt = 1, priority 2) = 1 * 10 + 2.
			expect(row).toEqual(
				expect.objectContaining({ workflowRunId: runId, status: "pending", rank: 12, nextPublishAttemptRank: 12 })
			);
		}));

	test("a task due within the lookahead window mints a timer carrying the run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingRetryTask(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1_030_000 },
				{ options: { priority: 2 } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// At now = 1_000_000 the task is not yet due, but its due time sits inside the
			// 60_000ms lookahead window.
			await withFakeClock(1_000_000, () =>
				processImminentRetryableTasks(
					context,
					{ repos, timerPriorityQueue },
					{ limit: 100, lookaheadWindowMs: 60_000, republishBackoff }
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

	test("a task whose run is no longer running promotes nothing", () =>
		withHarness(async ({ context, repos, publisher }) => {
			// The same seed a promotion test uses; only the pause below stops it.
			const { runId } = await seedAwaitingRetryTask(
				{ namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1 },
				{ options: { priority: 2 } }
			);

			const stateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller: createChildRunCanceller() });
			await stateMachine.transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runId,
				state: { status: "paused" },
			});

			await processImminentRetryableTasks(context, { repos }, { limit: 100, lookaheadWindowMs: 0, republishBackoff });

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "paused" }),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));
});
