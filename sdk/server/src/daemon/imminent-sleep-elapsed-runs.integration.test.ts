import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { processImminentSleepElapsedRuns, queueSleepElapsedRuns } from "./imminent-sleep-elapsed-runs";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import { END_OF_TIME, withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedSleepingRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentSleepElapsedRuns", () => {
	test("queues a run whose sleep is over", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenAsleep } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);

			await processImminentSleepElapsedRuns(
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
					run: expect.objectContaining({ id: runId, status: "queued", revision: revisionWhenAsleep + 1 }),
					state: { status: "queued", reason: "wakeup" },
				})
			);
		}));

	test("marks the sleep completed at the time of the wake-up", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);

			const scannedAt = Date.now();
			await withFakeClock(scannedAt, () =>
				processImminentSleepElapsedRuns(
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

			expect(await repos.sleep.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({
					workflowRunId: runId,
					name: "cool-down",
					status: "completed",
					completedAt: scannedAt,
					cancelledAt: null,
				}),
			]);
		}));

	test("charges no execution attempt", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenAsleep, attemptsWhenClaimed } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);

			await processImminentSleepElapsedRuns(
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
							revision: revisionWhenAsleep + 1,
							attempt: attemptsWhenClaimed,
							state: { status: "queued", reason: "wakeup" },
						}),
					],
				})
			);
		}));

	test("mints a fresh pending outbox row ranked at the wake-up time and the run's priority", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, wakeupAt } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 },
					{ options: { priority: 2 } }
				)
			);

			await processImminentSleepElapsedRuns(
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

			const wakeupRank = computeRank({ dueAt: wakeupAt, priority: 2 });
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(
				expect.objectContaining({
					workflowRunId: runId,
					status: "pending",
					rank: wakeupRank,
					nextPublishAttemptRank: wakeupRank,
				})
			);
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);

			await processImminentSleepElapsedRuns(
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

	test("leaves a run whose sleep is not over asleep", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const scannedAt = 1_000_000;
			const { runId, revisionWhenAsleep } = await withFakeClock(scannedAt, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);

			await withFakeClock(scannedAt, () =>
				processImminentSleepElapsedRuns(
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
					run: expect.objectContaining({ id: runId, status: "sleeping", revision: revisionWhenAsleep }),
				})
			);
			expect(await repos.sleep.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({ workflowRunId: runId, status: "sleeping", completedAt: null }),
			]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("queues the due run and hands the imminent one to the timer priority queue", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const scannedAt = 1_000_000;
			const dueRun = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 1 }
				)
			);
			const imminentRun = await withFakeClock(scannedAt, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: ONE_HOUR_MS }
				)
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			await withFakeClock(scannedAt, () =>
				processImminentSleepElapsedRuns(
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
				{ type: "sleep", id: imminentRun.runId, rank: computeRank({ dueAt: scannedAt + ONE_HOUR_MS }) },
			]);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: dueRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: dueRun.runId, status: "queued" }),
					state: { status: "queued", reason: "wakeup" },
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
						status: "sleeping",
						revision: imminentRun.revisionWhenAsleep,
					}),
				})
			);
		}));

	test("wakes a waiter when the earliest queued timer is overdue", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			await withFakeClock(1_000_000, () =>
				seedSleepingRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ sleepName: "cool-down", durationMs: 30_000 }
				)
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const waiter = timerPriorityQueue.createWaiter();
			// Due 30ms before the scan's clock, which is exactly the overshoot, so it sits at the overdue cutoff.
			const frontRunId = ulid();
			const frontRank = computeRank({ dueAt: 999_970 });
			await timerPriorityQueue.add({ timers: [{ type: "sleep", id: frontRunId, rank: frontRank }], overdueRank: 0 });
			expect(await waiter.wait(0)).toEqual({ rank: frontRank });

			await withFakeClock(1_000_000, () =>
				processImminentSleepElapsedRuns(
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
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const sleepingRuns = await withFakeClock(EPOCH_MS, async () => [
				await seedSleepingRun(seedDeps, { sleepName: "cool-down", durationMs: 1 }),
				await seedSleepingRun(seedDeps, { sleepName: "cool-down", durationMs: 1 }),
				await seedSleepingRun(seedDeps, { sleepName: "cool-down", durationMs: 1 }),
			]);

			await processImminentSleepElapsedRuns(
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

			for (const { runId } of sleepingRuns) {
				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "queued" }) }));
			}
		}));
});

describe("queueSleepElapsedRuns", () => {
	test("skips a run that was woken early after the listing", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const runA = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(seedDeps, { sleepName: "cool-down", durationMs: 1 })
			);
			const runB = await withFakeClock(EPOCH_MS, () =>
				seedSleepingRun(seedDeps, { sleepName: "cool-down", durationMs: 1 })
			);

			const listedRuns = await repos.workflowRun.listSleepElapsedRuns(context, END_OF_TIME, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([runA.runId, runB.runId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === runA.runId);
			const listedB = rankedRuns.find((run) => run.id === runB.runId);
			if (!listedA || !listedB) {
				throw new Error("Both sleeping runs must be listed as due");
			}

			const stateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller: createChildRunCanceller() });
			const wokenRunA = await stateMachine.transitionState(namespaceRequestContext, {
				type: "pessimistic",
				id: runA.runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" },
			});

			await queueSleepElapsedRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runA.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runA.runId, status: "scheduled", revision: wokenRunA.revision }),
				})
			);
			expect(await repos.sleep.listByWorkflowRunId(runA.runId)).toEqual([
				expect.objectContaining({ workflowRunId: runA.runId, status: "cancelled", completedAt: null }),
			]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runA.runId,
				})
			).toBeNull();

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runB.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runB.runId,
						status: "queued",
						revision: runB.revisionWhenAsleep + 1,
					}),
					state: { status: "queued", reason: "wakeup" },
				})
			);
		}));
});
