import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { processImminentTaskRetryableRuns, queueTaskRetryableRuns } from "./imminent-task-retryable-runs";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { END_OF_TIME, withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedAwaitingRetryTask, seedAwaitingTaskRetryRun } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentTaskRetryableRuns", () => {
	test("queues a run whose task retry is due", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenSuspended } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", revision: revisionWhenSuspended + 1 }),
					state: { status: "queued", reason: "task_retry" },
				})
			);
		}));

	test("charges no execution attempt", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenSuspended, attemptsWhenClaimed } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", attempts: attemptsWhenClaimed }),
				})
			);
			expect(await repos.stateTransition.listByRunId(runId, 1)).toEqual(
				expect.objectContaining({
					rows: [
						expect.objectContaining({
							workflowRunId: runId,
							type: "workflow_run",
							revision: revisionWhenSuspended + 1,
							attempt: attemptsWhenClaimed,
							state: { status: "queued", reason: "task_retry" },
						}),
					],
				})
			);
		}));

	test("mints a fresh pending outbox row ranked at the task's retry time and the run's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS },
				{ options: { priority: 2 } }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			const taskRetryRank = computeRank({ dueAt: EPOCH_MS, priority: 2 });
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(
				expect.objectContaining({
					workflowRunId: runId,
					status: "pending",
					rank: taskRetryRank,
					nextPublishAttemptRank: taskRetryRank,
				})
			);
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos, publisher },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "published" }));
		}));

	test("leaves a run whose task retry is not due suspended", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const scannedAt = 1_000_000;
			const { runId, revisionWhenSuspended } = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: scannedAt + 1 }
			);

			await withFakeClock(scannedAt, () =>
				processImminentTaskRetryableRuns(
					context,
					{ repos },
					{
						pageSize: 100,
						lookaheadWindowMs: 0,
						overshootMs: 0,
						republishBackoff,
						chunk: { size: 100, maxConcurrency: 10 },
					}
				)
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_task_retry", revision: revisionWhenSuspended }),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("leaves a running run alone even when its task's retry is due", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedAwaitingRetryTask(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "running", revision: revisionWhenClaimed }),
				})
			);
			// The delivery's claimed outbox row stays with the run until it is suspended.
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "claimed" }));
		}));

	test("queues the due run and hands the imminent one to the timer priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const scannedAt = 1_000_000;
			const dueRun = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);
			const imminentRun = await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: scannedAt + ONE_HOUR_MS },
				{ options: { priority: 2 } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			await withFakeClock(scannedAt, () =>
				processImminentTaskRetryableRuns(
					context,
					{ repos, timerPriorityQueue },
					{
						pageSize: 100,
						lookaheadWindowMs: 2 * ONE_HOUR_MS,
						overshootMs: 0,
						republishBackoff,
						chunk: { size: 100, maxConcurrency: 10 },
					}
				)
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{
					type: "task_retry",
					id: imminentRun.runId,
					rank: computeRank({ dueAt: scannedAt + ONE_HOUR_MS, priority: 2 }),
				},
			]);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: dueRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: dueRun.runId, status: "queued" }),
					state: { status: "queued", reason: "task_retry" },
				})
			);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: imminentRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: imminentRun.runId,
						status: "awaiting_task_retry",
						revision: imminentRun.revisionWhenSuspended,
					}),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: imminentRun.runId,
				})
			).toBeNull();
		}));

	test("wakes a waiter when the earliest queued timer is overdue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			await seedAwaitingTaskRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1_030_000 }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const waiter = timerPriorityQueue.createWaiter();
			const frontRunId = ulid();
			// Due 30ms before the scan's clock, which is exactly the overshoot, so it sits at the overdue cutoff.
			const frontRank = computeRank({ dueAt: 999_970 });
			await timerPriorityQueue.add({ timers: [{ type: "sleep", id: frontRunId, rank: frontRank }], overdueRank: 0 });
			expect(await waiter.wait(0)).toEqual({ rank: frontRank });

			await withFakeClock(1_000_000, () =>
				processImminentTaskRetryableRuns(
					context,
					{ repos, timerPriorityQueue },
					{
						pageSize: 100,
						lookaheadWindowMs: 60_000,
						overshootMs: 30,
						republishBackoff,
						chunk: { size: 100, maxConcurrency: 10 },
					}
				)
			);

			expect(await waiter.wait(0)).toEqual({ rank: frontRank });
			await waiter.close();
		}));

	test("drains every due run when they outnumber the page size", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const suspendedRuns = [
				await seedAwaitingTaskRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
				await seedAwaitingTaskRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
				await seedAwaitingTaskRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
			];

			await processImminentTaskRetryableRuns(
				context,
				{ repos },
				{
					pageSize: 2,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff,
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			for (const { runId } of suspendedRuns) {
				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "queued" }) }));
			}
		}));
});

describe("queueTaskRetryableRuns", () => {
	test("skips a run that moved after the listing", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const runA = await seedAwaitingTaskRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS });
			const runB = await seedAwaitingTaskRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS });

			const listedRuns = await repos.workflowRun.listTaskRetryableRuns(context, END_OF_TIME, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([runA.runId, runB.runId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === runA.runId);
			const listedB = rankedRuns.find((run) => run.id === runB.runId);
			if (!listedA || !listedB) {
				throw new Error("Both suspended runs must be listed as due");
			}

			// The first pass queues A, moving it past the listing's revision snapshot.
			await queueTaskRetryableRuns(context, repos, undefined, republishBackoff, [listedA]);
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runA.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runA.runId, status: "queued", revision: listedA.revision + 1 }),
				})
			);

			// The replayed batch still carries A at the revision it had when suspended. A must not be
			// queued a second time.
			await queueTaskRetryableRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runA.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runA.runId,
						status: "queued",
						revision: runA.revisionWhenSuspended + 1,
					}),
				})
			);
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runB.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runB.runId,
						status: "queued",
						revision: runB.revisionWhenSuspended + 1,
					}),
					state: { status: "queued", reason: "task_retry" },
				})
			);
		}));
});
