import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { describe, expect, test } from "vitest";

import { processImminentRetryableRuns, queueRetryableRuns } from "./imminent-retryable-runs";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { END_OF_TIME, withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedAwaitingRetryRun } from "../testing/seed/run";
import { seedAwaitingRetryRunAfterTaskFailure } from "../testing/seed/task";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentRetryableRuns", () => {
	test("queues a run whose retry is due", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenSuspended } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentRetryableRuns(
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

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", revision: revisionWhenSuspended + 1 }),
					state: { status: "queued", reason: "retry" },
				})
			);
		}));

	test("charges exactly one execution attempt", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenSuspended, attemptsWhenClaimed } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentRetryableRuns(
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

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", attempts: attemptsWhenClaimed + 1 }),
				})
			);
			// The daemon writes the run's count and the transition's count separately; they must agree.
			expect(await repos.stateTransition.listByRunId(runId, 1)).toEqual(
				expect.objectContaining({
					rows: [
						expect.objectContaining({
							workflowRunId: runId,
							type: "workflow_run",
							revision: revisionWhenSuspended + 1,
							attempt: attemptsWhenClaimed + 1,
							state: { status: "queued", reason: "retry" },
						}),
					],
				})
			);
		}));

	test("mints a fresh pending outbox row ranked at the retry time and the run's priority", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS },
				{ options: { priority: 2 } }
			);

			await processImminentRetryableRuns(
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

			const rank = computeRank({ dueAt: EPOCH_MS, priority: 2 });
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(
				expect.objectContaining({ workflowRunId: runId, status: "pending", rank, nextPublishAttemptRank: rank })
			);
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentRetryableRuns(
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

	test("discards the tasks the failed attempt left running, awaiting a retry or failed, and keeps the completed one", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, taskIdByStatus } = await seedAwaitingRetryRunAfterTaskFailure(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			await processImminentRetryableRuns(
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

			const discardedTasks = await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["discarded"]);
			expect(discardedTasks.map((task) => task.id).sort()).toEqual(
				[taskIdByStatus.running, taskIdByStatus.awaiting_retry, taskIdByStatus.failed].sort()
			);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["completed"])).toEqual([
				expect.objectContaining({ id: taskIdByStatus.completed, status: "completed" }),
			]);
		}));

	test("leaves a run whose retry is not due suspended", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const scannedAt = 1_000_000;
			const { runId, revisionWhenSuspended, attemptsWhenClaimed } = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: scannedAt + 1 }
			);

			await withFakeClock(scannedAt, () =>
				processImminentRetryableRuns(
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

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "awaiting_retry",
						revision: revisionWhenSuspended,
						attempts: attemptsWhenClaimed,
					}),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("queues the due retry and hands the imminent one to the timer priority queue", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const scannedAt = 1_000_000;
			const dueRun = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);
			const imminentRun = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: scannedAt + ONE_HOUR_MS }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			await withFakeClock(scannedAt, () =>
				processImminentRetryableRuns(
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
				{ type: "retry", id: imminentRun.runId, rank: computeRank({ dueAt: scannedAt + ONE_HOUR_MS }) },
			]);

			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: dueRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: dueRun.runId, status: "queued" }),
					state: { status: "queued", reason: "retry" },
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
						status: "awaiting_retry",
						revision: imminentRun.revisionWhenSuspended,
					}),
				})
			);
		}));

	test("wakes a waiter when the earliest queued timer is overdue", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: 1_030_000 }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const waiter = timerPriorityQueue.createWaiter();
			// Due 30ms before the scan's clock, which is exactly the overshoot, so it sits at the overdue cutoff.
			const frontRank = computeRank({ dueAt: 999_970 });
			await timerPriorityQueue.add({ timers: [{ type: "sleep", id: "run-front", rank: frontRank }], overdueRank: 0 });
			expect(await waiter.wait(0)).toEqual({ rank: frontRank });

			await withFakeClock(1_000_000, () =>
				processImminentRetryableRuns(
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

	test("drains every due retry when they outnumber the page size", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const suspendedRuns = [
				await seedAwaitingRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
				await seedAwaitingRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
				await seedAwaitingRetryRun(seedDeps, { nextAttemptAt: EPOCH_MS }),
			];

			await processImminentRetryableRuns(
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
				const run = await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runId,
				});
				expect(run).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "queued" }) }));
			}
		}));
});

describe("queueRetryableRuns", () => {
	test("skips a run that moved after the listing without charging it a second attempt", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const runA = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);
			const runB = await seedAwaitingRetryRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ nextAttemptAt: EPOCH_MS }
			);

			const listedRuns = await repos.workflowRun.listRetryableRuns(context, END_OF_TIME, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([runA.runId, runB.runId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === runA.runId);
			const listedB = rankedRuns.find((run) => run.id === runB.runId);
			if (!listedA || !listedB) {
				throw new Error("Both suspended runs must be listed as due");
			}

			// The first pass queues A, moving it past the listing's revision snapshot.
			await queueRetryableRuns(context, repos, undefined, republishBackoff, [listedA]);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runA.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runA.runId, status: "queued", revision: listedA.revision + 1 }),
				})
			);

			// The replayed batch still carries A at the revision it had when suspended — the race the
			// revision guard settles. A must not be charged or queued a second time.
			await queueRetryableRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			const rowA = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runA.runId,
			});
			expect(rowA).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runA.runId,
						status: "queued",
						revision: runA.revisionWhenSuspended + 1,
						attempts: runA.attemptsWhenClaimed + 1,
					}),
				})
			);

			const rowB = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runB.runId,
			});
			expect(rowB).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runB.runId,
						status: "queued",
						revision: runB.revisionWhenSuspended + 1,
						attempts: runB.attemptsWhenClaimed + 1,
					}),
					state: { status: "queued", reason: "retry" },
				})
			);
		}));
});
