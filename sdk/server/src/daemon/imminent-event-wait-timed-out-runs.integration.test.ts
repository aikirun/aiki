import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import { processImminentEventWaitTimedOutRuns, queueEventWaitTimedOutRuns } from "./imminent-event-wait-timed-out-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness } from "../testing/harness";
import { seedAwaitingEventRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

describe("processImminentEventWaitTimedOutRuns", () => {
	test("queues a run whose event wait timed out", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			// Parked at the epoch with a 1ms timeout: the deadline is overdue for any daemon
			// pass under the real clock.
			const { runId, revisionWhenParked } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", revision: revisionWhenParked + 1 }),
					state: { status: "queued", reason: "event_wait_timeout" },
				})
			);
		}));

	test("stamps the timeout row with the run's bumped sequence", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			const timedOutAt = Date.now() as TimestampMs;
			await withFakeClock(timedOutAt, () =>
				processImminentEventWaitTimedOutRuns(context, { repos }, { limit: 100, lookaheadWindowMs: 0, republishBackoff })
			);

			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
				expect.objectContaining({
					workflowRunId: runId,
					name: "orderShipped",
					status: "timeout",
					timedOutAt,
					data: null,
					referenceId: null,
					signalSequence: 1,
				}),
			]);
			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", signalSequence: 1 }),
					state: { status: "queued", reason: "event_wait_timeout" },
				})
			);
		}));

	test("mints a fresh pending outbox row ranked at the wait's deadline", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, workflowSource, workflowName, workflowVersionId } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(
				expect.objectContaining({
					workflowRunId: runId,
					status: "pending",
					workflowSource,
					workflowName,
					workflowVersionId,
					// computeRank(timeoutAt = EPOCH_MS + 1, default priority 5) = 2 * 10 + 5.
					rank: 25,
					nextPublishAttemptRank: 25,
				})
			);
		}));

	test("charges no execution attempt for the timed-out wait", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, attemptsWhenClaimed } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "queued", attempts: attemptsWhenClaimed }),
				})
			);
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos, publisher },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "published" }));
		}));

	test("leaves a run whose deadline has not passed parked", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { runId, revisionWhenParked } = await seedAwaitingEventRun(
				{ daemonContext: context, namespaceRequestContext, repos, publisher },
				{ eventName: "orderShipped", timeoutInMs: ONE_HOUR_MS }
			);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_event", revision: revisionWhenParked }),
				})
			);
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("never times out a wait parked without a deadline", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			// Parked at the epoch: any deadline this old would be overdue — only the absent
			// timeout spares the run.
			const { runId, revisionWhenParked } = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped" }
				)
			);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_event", revision: revisionWhenParked }),
				})
			);
			expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: runId,
				})
			).toBeNull();
		}));

	test("queues the due wait and hands the imminent one to the timer priority queue", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const due = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			const parkedAt = Date.now() as TimestampMs;
			const imminent = await withFakeClock(parkedAt, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: ONE_HOUR_MS }
				)
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// Frozen at the park instant: the due wait's deadline is behind now, the imminent
			// one an hour ahead but inside the two-hour lookahead window.
			await withFakeClock(parkedAt, () =>
				processImminentEventWaitTimedOutRuns(
					context,
					{ repos, timerPriorityQueue },
					{ limit: 100, lookaheadWindowMs: 2 * ONE_HOUR_MS, republishBackoff }
				)
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{
					type: "event_wait_timeout",
					id: imminent.runId,
					rank: computeRank({ dueAt: parkedAt + ONE_HOUR_MS }),
				},
			]);

			const dueRun = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: due.runId,
			});
			expect(dueRun).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: due.runId, status: "queued" }),
					state: { status: "queued", reason: "event_wait_timeout" },
				})
			);

			const imminentRun = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: imminent.runId,
			});
			expect(imminentRun).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: imminent.runId,
						status: "awaiting_event",
						revision: imminent.revisionWhenParked,
					}),
				})
			);
		}));

	test("drains every due wait when they outnumber the limit", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const seedDeps = { daemonContext: context, namespaceRequestContext, repos, publisher };
			const parked = await withFakeClock(EPOCH_MS, async () => [
				await seedAwaitingEventRun(seedDeps, { eventName: "orderShipped", timeoutInMs: 1 }),
				await seedAwaitingEventRun(seedDeps, { eventName: "orderShipped", timeoutInMs: 1 }),
				await seedAwaitingEventRun(seedDeps, { eventName: "orderShipped", timeoutInMs: 1 }),
			]);

			await processImminentEventWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 2, lookaheadWindowMs: 0, republishBackoff }
			);

			for (const { runId } of parked) {
				const run = await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: runId,
				});
				expect(run).toEqual(expect.objectContaining({ run: expect.objectContaining({ id: runId, status: "queued" }) }));
			}
		}));
});

describe("queueEventWaitTimedOutRuns", () => {
	test("skips a run that moved after the listing without bumping or stamping it twice", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const runA = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);
			const runB = await withFakeClock(EPOCH_MS, () =>
				seedAwaitingEventRun(
					{ daemonContext: context, namespaceRequestContext, repos, publisher },
					{ eventName: "orderShipped", timeoutInMs: 1 }
				)
			);

			const listedRuns = await repos.workflowRun.listEventWaitTimedOutRuns(context, Date.now() as TimestampMs, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([runA.runId, runB.runId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === runA.runId);
			const listedB = rankedRuns.find((run) => run.id === runB.runId);
			if (!listedA || !listedB) {
				throw new Error("Both parked runs must be listed as due");
			}

			// The first pass queues A, moving it past the listing's revision snapshot.
			await queueEventWaitTimedOutRuns(context, repos, undefined, republishBackoff, [listedA]);

			// The replayed batch still carries A at its parked revision — the race the
			// revision guard settles. A must not get a second row, stamp, or bump.
			await queueEventWaitTimedOutRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			expect(await repos.eventWait.listByWorkflowRunId(runA.runId)).toEqual([
				expect.objectContaining({ workflowRunId: runA.runId, status: "timeout", signalSequence: 1 }),
			]);
			const rowA = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runA.runId,
			});
			expect(rowA).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runA.runId, status: "queued", signalSequence: 1 }),
				})
			);

			expect(await repos.eventWait.listByWorkflowRunId(runB.runId)).toEqual([
				expect.objectContaining({ workflowRunId: runB.runId, status: "timeout", signalSequence: 1 }),
			]);
			const rowB = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: runB.runId,
			});
			expect(rowB).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runB.runId, status: "queued", signalSequence: 1 }),
					state: { status: "queued", reason: "event_wait_timeout" },
				})
			);
		}));
});
