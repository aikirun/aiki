import { noopLogger } from "@aikirun/lib/logger";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";

import {
	processImminentChildRunWaitTimedOutRuns,
	queueChildRunWaitTimedOutRuns,
} from "./imminent-child-run-wait-timed-out-runs";
import { describe, expect, test } from "bun:test";
import { defaultServerRuntimeConfig } from "../config/runtime";
import { computeRank } from "../lib/rank";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunStateMachine } from "../service/state-machine/workflow-run";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createDaemonHarness, type DaemonHarnessDeps } from "../testing/harness";
import { seedClaimedRun, seedScheduledRun } from "../testing/seed/run";

const withHarness = createDaemonHarness();

const namespaceRequestContext = namespaceRequestContextFactory.build();

const EPOCH_MS = 1 as TimestampMs;
const ONE_HOUR_MS = 1 * 60 * 60 * 1000;

const { republishBackoff } = defaultServerRuntimeConfig.daemons.publishPendingOutboxEntries;

// Creates a running parent, creates a scheduled child under it, and parks the parent on that child.
async function parkParentOnChild(deps: DaemonHarnessDeps, params?: { timeoutInMs?: number }) {
	const { context, repos, publisher } = deps;
	const parent = await seedClaimedRun({ daemonContext: context, namespaceRequestContext, repos, publisher });
	const child = await seedScheduledRun(
		{ namespaceRequestContext, repos },
		{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
	);

	const stateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller: createChildRunCanceller() });
	const parked = await stateMachine.transitionState(namespaceRequestContext, {
		type: "optimistic",
		id: parent.runId,
		state: {
			status: "awaiting_child_workflow",
			childWorkflowRunId: child.runId,
			timeoutInMs: params?.timeoutInMs,
		},
		expectedRevision: parent.revisionWhenClaimed,
		expectedSignalSequence: 0,
	});

	return {
		parentRunId: parent.runId,
		childRunId: child.runId,
		attemptsWhenClaimed: parent.attemptsWhenClaimed,
		revisionWhenParked: parked.revision,
		workflowSource: parent.workflowSource,
		workflowName: parent.workflowName,
		workflowVersionId: parent.workflowVersionId,
	};
}

describe("processImminentChildRunWaitTimedOutRuns", () => {
	test("queues a parent whose child wait timed out", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			// Parked at the epoch with a 1ms timeout: the deadline is overdue for any daemon
			// pass under the real clock.
			const { parentRunId, revisionWhenParked } = await withFakeClock(EPOCH_MS, () =>
				parkParentOnChild(deps, { timeoutInMs: 1 })
			);

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentRunId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: parentRunId, status: "queued", revision: revisionWhenParked + 1 }),
					state: { status: "queued", reason: "child_workflow_wait_timeout" },
				})
			);
		}));

	test("records the timed-out wait without a terminal outcome for the child", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { parentRunId, childRunId } = await withFakeClock(EPOCH_MS, () =>
				parkParentOnChild(deps, { timeoutInMs: 1 })
			);

			const timedOutAt = Date.now() as TimestampMs;
			await withFakeClock(timedOutAt, () =>
				processImminentChildRunWaitTimedOutRuns(
					context,
					{ repos },
					{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
				)
			);

			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parentRunId)).toEqual([
				expect.objectContaining({
					parentWorkflowRunId: parentRunId,
					childWorkflowRunId: childRunId,
					status: "timeout",
					timedOutAt,
					completedAt: null,
					childWorkflowRunStatus: null,
					childWorkflowRunStateTransitionId: null,
					childWorkflowRunState: null,
					signalSequence: null,
				}),
			]);
		}));

	test("mints a fresh pending outbox row ranked at the wait's deadline", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { parentRunId, workflowSource, workflowName, workflowVersionId } = await withFakeClock(EPOCH_MS, () =>
				parkParentOnChild(deps, { timeoutInMs: 1 })
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: parentRunId,
				})
			).toBeNull();

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: parentRunId,
				})
			).toEqual(
				expect.objectContaining({
					workflowRunId: parentRunId,
					status: "pending",
					workflowSource,
					workflowName,
					workflowVersionId,
					// computeRank(timeoutAt = EPOCH_MS + 1, default priority 9) = 2 * 10 + 9.
					rank: 29,
					nextPublishAttemptRank: 29,
				})
			);
		}));

	test("charges no execution attempt for the timed-out wait", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { parentRunId, attemptsWhenClaimed } = await withFakeClock(EPOCH_MS, () =>
				parkParentOnChild(deps, { timeoutInMs: 1 })
			);

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentRunId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: parentRunId, status: "queued", attempts: attemptsWhenClaimed }),
				})
			);
		}));

	test("publishes the fresh outbox row when a publisher is wired", () =>
		withHarness(async (deps) => {
			const { context, repos, publisher } = deps;
			const { parentRunId } = await withFakeClock(EPOCH_MS, () => parkParentOnChild(deps, { timeoutInMs: 1 }));

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos, publisher },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: parentRunId,
				})
			).toEqual(expect.objectContaining({ workflowRunId: parentRunId, status: "published" }));
		}));

	test("leaves a parent whose deadline has not passed parked", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const { parentRunId, revisionWhenParked } = await parkParentOnChild(deps, { timeoutInMs: ONE_HOUR_MS });

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentRunId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: parentRunId,
						status: "awaiting_child_workflow",
						revision: revisionWhenParked,
					}),
				})
			);
			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parentRunId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: parentRunId,
				})
			).toBeNull();
		}));

	test("never times out a wait parked without a deadline", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			// Parked at the epoch: any deadline this old would be overdue — only the absent
			// timeout spares the parent.
			const { parentRunId, revisionWhenParked } = await withFakeClock(EPOCH_MS, () => parkParentOnChild(deps));

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff }
			);

			const run = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentRunId,
			});
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: parentRunId,
						status: "awaiting_child_workflow",
						revision: revisionWhenParked,
					}),
				})
			);
			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parentRunId)).toEqual([]);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({
					namespaceId: namespaceRequestContext.namespaceId,
					workflowRunId: parentRunId,
				})
			).toBeNull();
		}));

	test("queues the due wait and hands the imminent one to the timer priority queue", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const due = await withFakeClock(EPOCH_MS, () => parkParentOnChild(deps, { timeoutInMs: 1 }));

			const parkedAt = Date.now() as TimestampMs;
			const imminent = await withFakeClock(parkedAt, () => parkParentOnChild(deps, { timeoutInMs: ONE_HOUR_MS }));

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			// Frozen at the park instant: the due wait's deadline is behind now, the imminent
			// one an hour ahead but inside the two-hour lookahead window.
			await withFakeClock(parkedAt, () =>
				processImminentChildRunWaitTimedOutRuns(
					context,
					{ repos, timerPriorityQueue },
					{ limit: 100, lookaheadWindowMs: 2 * ONE_HOUR_MS, republishBackoff }
				)
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{
					type: "child_wait_timeout",
					id: imminent.parentRunId,
					rank: computeRank({ dueAt: parkedAt + ONE_HOUR_MS }),
				},
			]);

			const dueRun = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: due.parentRunId,
			});
			expect(dueRun).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: due.parentRunId, status: "queued" }),
					state: { status: "queued", reason: "child_workflow_wait_timeout" },
				})
			);

			const imminentRun = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: imminent.parentRunId,
			});
			expect(imminentRun).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: imminent.parentRunId,
						status: "awaiting_child_workflow",
						revision: imminent.revisionWhenParked,
					}),
				})
			);
		}));

	test("drains every due wait when they outnumber the limit", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const parked = await withFakeClock(EPOCH_MS, async () => [
				await parkParentOnChild(deps, { timeoutInMs: 1 }),
				await parkParentOnChild(deps, { timeoutInMs: 1 }),
				await parkParentOnChild(deps, { timeoutInMs: 1 }),
			]);

			await processImminentChildRunWaitTimedOutRuns(
				context,
				{ repos },
				{ limit: 2, lookaheadWindowMs: 0, republishBackoff }
			);

			for (const { parentRunId } of parked) {
				const run = await repos.workflowRun.getByIdWithState({
					namespaceId: namespaceRequestContext.namespaceId,
					id: parentRunId,
				});
				expect(run).toEqual(
					expect.objectContaining({ run: expect.objectContaining({ id: parentRunId, status: "queued" }) })
				);
			}
		}));
});

describe("queueChildRunWaitTimedOutRuns", () => {
	test("skips a parent that moved after the listing without holding back the rest of the batch", () =>
		withHarness(async (deps) => {
			const { context, repos } = deps;
			const parentA = await withFakeClock(EPOCH_MS, () => parkParentOnChild(deps, { timeoutInMs: 1 }));
			const parentB = await withFakeClock(EPOCH_MS, () => parkParentOnChild(deps, { timeoutInMs: 1 }));

			const listedRuns = await repos.workflowRun.listChildRunWaitTimedOutRuns(context, Date.now() as TimestampMs, 100);
			expect(listedRuns.map((run) => run.id).sort()).toEqual([parentA.parentRunId, parentB.parentRunId].sort());

			const rankedRuns = listedRuns.map((run) => ({ ...run, rank: computeRank({ dueAt: run.dueAt }) }));
			const listedA = rankedRuns.find((run) => run.id === parentA.parentRunId);
			const listedB = rankedRuns.find((run) => run.id === parentB.parentRunId);
			if (!listedA || !listedB) {
				throw new Error("Both parked parents must be listed as due");
			}

			// The first pass queues A, moving it past the listing's revision snapshot.
			await queueChildRunWaitTimedOutRuns(context, repos, undefined, republishBackoff, [listedA]);

			// The replayed batch still carries A at its parked revision — the race the
			// revision guard settles.
			await queueChildRunWaitTimedOutRuns(context, repos, undefined, republishBackoff, [listedA, listedB]);

			// A keeps the single first-pass timeout row and the single revision bump.
			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parentA.parentRunId)).toEqual([
				expect.objectContaining({ parentWorkflowRunId: parentA.parentRunId, status: "timeout" }),
			]);
			const runA = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentA.parentRunId,
			});
			expect(runA).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: parentA.parentRunId,
						status: "queued",
						revision: parentA.revisionWhenParked + 1,
					}),
				})
			);

			// B, untouched by the first pass, is queued by the second.
			const runB = await repos.workflowRun.getByIdWithState({
				namespaceId: namespaceRequestContext.namespaceId,
				id: parentB.parentRunId,
			});
			expect(runB).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: parentB.parentRunId,
						status: "queued",
						revision: parentB.revisionWhenParked + 1,
					}),
					state: { status: "queued", reason: "child_workflow_wait_timeout" },
				})
			);
			expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parentB.parentRunId)).toEqual([
				expect.objectContaining({ parentWorkflowRunId: parentB.parentRunId, status: "timeout" }),
			]);
		}));
});
