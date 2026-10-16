import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { WorkflowRunId, WorkflowRunScheduledReason } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { processImminentScheduledRuns, queueScheduledRuns } from "./imminent-scheduled-runs";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createEventService } from "../service/event";
import { createWorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import { END_OF_TIME, withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness, type DaemonHarnessDeps } from "../testing/harness";
import {
	seedAwaitingChildRun,
	seedAwaitingEventRun,
	seedPausedRun,
	seedPooledScheduledRun,
	seedScheduledRun,
	seedSleepingRun,
	seedStalledRun,
} from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentScheduledRuns", () => {
	test("mints a fresh pending outbox row ranked at the scheduled time and the run's priority", () =>
		withHarness(async ({ context, repos }) => {
			const scheduledAt = 1_000_000;
			const { runId } = await withFakeClock(scheduledAt, () =>
				seedScheduledRun({ namespaceRequestContext, repos }, { options: { priority: 2 } })
			);

			await withFakeClock(scheduledAt, () =>
				processImminentScheduledRuns(
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

			const scheduledRank = computeRank({ dueAt: scheduledAt, priority: 2 });
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(
				expect.objectContaining({
					workflowRunId: runId,
					status: "pending",
					rank: scheduledRank,
					nextPublishAttemptRank: scheduledRank,
				})
			);
		}));

	type SeedScheduledRun = (deps: Pick<DaemonHarnessDeps, "context" | "repos" | "publisher">) => Promise<{
		runId: string;
	}>;

	// Each run reaches `scheduled` the way production gets it there, with the move frozen at the epoch
	// so the run is due for any scan under the real clock.
	const seedScheduledRunByReason = {
		new: async ({ repos }) => withFakeClock(EPOCH_MS, () => seedScheduledRun({ namespaceRequestContext, repos })),
		resumption: async ({ context, repos, publisher }) => {
			const { runId } = await seedPausedRun({ daemonContext: context, namespaceRequestContext, repos, publisher });
			await withFakeClock(EPOCH_MS, () =>
				createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "resumption" },
				})
			);
			return { runId };
		},
		wakeup_early: async ({ context, repos, publisher }) => {
			const { runId } = await seedSleepingRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ sleepName: "cool-down", durationMs: ONE_HOUR_MS }
			);
			await withFakeClock(EPOCH_MS, () =>
				createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" },
				})
			);
			return { runId };
		},
		event: async ({ context, repos, publisher }) => {
			const { runId } = await seedAwaitingEventRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ eventName: "paymentReceived" }
			);
			const workflowRunStateMachine = createWorkflowRunStateMachine({
				repos,
			});
			await withFakeClock(EPOCH_MS, () =>
				createEventService({ repos, workflowRunStateMachine }).sendEventToWorkflowRun(namespaceRequestContext, {
					runId: runId as WorkflowRunId,
					eventName: "paymentReceived",
					data: asOpaquePayload({ amount: 25 }),
					clientCodecApplied: false,
					reference: undefined,
				})
			);
			return { runId };
		},
		child_workflow: async ({ context, repos, publisher }) => {
			const parentRun = await seedAwaitingChildRun({
				daemonContext: context,
				namespaceRequestContext,
				repos,
				publisher,
			});
			await withFakeClock(EPOCH_MS, () =>
				createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
					type: "optimistic",
					id: parentRun.child.runId,
					state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
					expectedRevision: parentRun.child.revisionWhenClaimed,
				})
			);
			return { runId: parentRun.runId };
		},
		redelivery: async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ daemonContext: context, namespaceRequestContext, repos });
			await withFakeClock(EPOCH_MS, () =>
				createWorkflowRunStateMachine({ repos }).transitionState(namespaceRequestContext, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
				})
			);
			return { runId };
		},
	} satisfies Record<WorkflowRunScheduledReason, SeedScheduledRun>;

	for (const [reason, seedRun] of Object.entries(seedScheduledRunByReason)) {
		test(`queues a due run scheduled for ${reason} with the same reason`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ context, repos, publisher });
				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(
					expect.objectContaining({
						run: expect.objectContaining({ id: runId, status: "scheduled" }),
						state: { status: "scheduled", reason, scheduledAt: EPOCH_MS },
					})
				);

				await processImminentScheduledRuns(
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
						run: expect.objectContaining({ id: runId, status: "queued" }),
						state: { status: "queued", reason },
					})
				);
			}));
	}

	test("charges no execution attempt", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, revisionWhenScheduled, attemptsWhenScheduled } = await withFakeClock(EPOCH_MS, () =>
				seedScheduledRun({ namespaceRequestContext, repos })
			);

			await processImminentScheduledRuns(
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
					run: expect.objectContaining({ id: runId, status: "queued", attempts: attemptsWhenScheduled }),
				})
			);
			expect(await repos.stateTransition.listByRunId(runId, 1)).toEqual(
				expect.objectContaining({
					rows: [
						expect.objectContaining({
							workflowRunId: runId,
							type: "workflow_run",
							revision: revisionWhenScheduled + 1,
							attempt: attemptsWhenScheduled,
							state: { status: "queued", reason: "new" },
						}),
					],
				})
			);
		}));

	test("the outbox row carries the run's pool", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, pool } = await withFakeClock(EPOCH_MS, () =>
				seedPooledScheduledRun({ repos, namespaceRequestContext })
			);

			await processImminentScheduledRuns(
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
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "pending", pool }));
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await withFakeClock(EPOCH_MS, () => seedScheduledRun({ namespaceRequestContext, repos }));

			await processImminentScheduledRuns(
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

	test("leaves a run scheduled for later alone", () =>
		withHarness(async ({ context, repos }) => {
			const scannedAt = 1_000_000;
			const { runId, revisionWhenScheduled } = await withFakeClock(scannedAt + 1, () =>
				seedScheduledRun({ namespaceRequestContext, repos })
			);

			await withFakeClock(scannedAt, () =>
				processImminentScheduledRuns(
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
					run: expect.objectContaining({ id: runId, status: "scheduled", revision: revisionWhenScheduled }),
				})
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("queues the due run and hands the imminent one to the timer priority queue", () =>
		withHarness(async ({ context, repos }) => {
			const scannedAt = 1_000_000;
			const dueRun = await withFakeClock(EPOCH_MS, () => seedScheduledRun({ namespaceRequestContext, repos }));
			const imminentRun = await withFakeClock(scannedAt + ONE_HOUR_MS, () =>
				seedScheduledRun({ namespaceRequestContext, repos })
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			await withFakeClock(scannedAt, () =>
				processImminentScheduledRuns(
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
				{ type: "scheduled", id: imminentRun.runId, rank: computeRank({ dueAt: scannedAt + ONE_HOUR_MS }) },
			]);
			expect(
				await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: dueRun.runId,
				})
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: dueRun.runId, status: "queued" }),
					state: { status: "queued", reason: "new" },
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
						status: "scheduled",
						revision: imminentRun.revisionWhenScheduled,
					}),
				})
			);
		}));

	test("wakes a waiter when the earliest queued timer is overdue", () =>
		withHarness(async ({ context, repos }) => {
			await withFakeClock(1_030_000, () => seedScheduledRun({ namespaceRequestContext, repos }));

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const waiter = timerPriorityQueue.createWaiter();
			const frontRunId = ulid();
			// Due 30ms before the scan's clock, which is exactly the overshoot, so it sits at the overdue cutoff.
			const frontRank = computeRank({ dueAt: 999_970 });
			await timerPriorityQueue.add({ timers: [{ type: "sleep", id: frontRunId, rank: frontRank }], overdueRank: 0 });
			expect(await waiter.wait(0)).toEqual({ rank: frontRank });

			await withFakeClock(1_000_000, () =>
				processImminentScheduledRuns(
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
		withHarness(async ({ context, repos }) => {
			const seedDeps = { namespaceRequestContext, repos };
			const scheduledRuns = await withFakeClock(EPOCH_MS, async () => [
				await seedScheduledRun(seedDeps),
				await seedScheduledRun(seedDeps),
				await seedScheduledRun(seedDeps),
			]);

			await processImminentScheduledRuns(
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

			for (const { runId } of scheduledRuns) {
				expect(
					await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runId })
				).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "queued" }) }));
			}
		}));
});

describe("queueScheduledRuns", () => {
	test("skips a run that was paused after the listing", () =>
		withHarness(async ({ context, repos }) => {
			const seedDeps = { namespaceRequestContext, repos };
			const runA = await withFakeClock(EPOCH_MS, () => seedScheduledRun(seedDeps));
			const runB = await withFakeClock(EPOCH_MS, () => seedScheduledRun(seedDeps));

			const listedRuns = await repos.workflowRun.listDueScheduleRuns(context, END_OF_TIME, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([runA.runId, runB.runId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === runA.runId);
			const listedB = rankedRuns.find((run) => run.id === runB.runId);
			if (!listedA || !listedB) {
				throw new Error("Both scheduled runs must be listed as due");
			}

			const pausedRunA = await createWorkflowRunStateMachine({
				repos,
			}).transitionState(namespaceRequestContext, { type: "pessimistic", id: runA.runId, state: { status: "paused" } });

			await queueScheduledRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: namespaceRequestContext.namespaceId, id: runA.runId })
			).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runA.runId, status: "paused", revision: pausedRunA.revision }),
				})
			);
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
						revision: runB.revisionWhenScheduled + 1,
					}),
					state: { status: "queued", reason: "new" },
				})
			);
		}));
});
