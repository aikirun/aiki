import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { FakePublisher } from "@aikirun/testing/infra/queue";
import type { WaitingForSignalWorkflowRunStatus, WorkflowRunId } from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";

import type { Repositories } from "./types";
import type { DueWorkflowRun } from "./types/workflow-run";
import { describe, expect, test } from "bun:test";
import type { NamespaceRequestContext } from "../../middleware/context";
import { withFakeClock } from "../../testing/clock";
import { daemonContextFactory } from "../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../testing/harness";
import { seedAwaitingEventRun, seedClaimedRun, seedCompletedRun } from "../../testing/seed/run";

const withHarness = createServiceHarness();

describe("workflow run repository state reads", () => {
	test("getByIdWithWorkflowAndState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));

	test("getByIdWithState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));

	test("getByReferenceWithWorkflowAndState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const referenceId = "order-7-ref";
			const { workflowName, workflowVersionId, workflowSource } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined, options: { reference: { id: referenceId } } }
			);

			const row = await repos.workflowRun.getByReferenceWithWorkflowAndState({
				namespaceId: context.namespaceId,
				name: workflowName,
				versionId: workflowVersionId,
				source: workflowSource,
				referenceId,
			});

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));
});

describe("update guarded on the signal sequence", () => {
	// Each waiting status has its own timed-out scan; the cell is the read that would surface
	// the stored timeout.
	const waitingStatusCases = {
		awaiting_event: {
			status: "awaiting_event",
			listTimedOutRuns: (repos: Repositories, before: TimestampMs) =>
				repos.workflowRun.listEventWaitTimedOutRuns(daemonContextFactory.build(), before, 10),
		},
		awaiting_child_workflow: {
			status: "awaiting_child_workflow",
			listTimedOutRuns: (repos: Repositories, before: TimestampMs) =>
				repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContextFactory.build(), before, 10),
		},
	} satisfies {
		[S in WaitingForSignalWorkflowRunStatus]: {
			status: S;
			listTimedOutRuns: (repos: Repositories, before: TimestampMs) => Promise<DueWorkflowRun[]>;
		};
	};

	for (const { status, listTimedOutRuns } of Object.values(waitingStatusCases)) {
		test(`applies the matched ${status} update when the sequence is unchanged`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId, revisionWhenClaimed } = await seedClaimedRun({
					namespaceRequestContext: context,
					repos,
					publisher,
				});

				const result = await repos.workflowRun.update({
					waitForSignal: true,
					filter: {
						namespaceId: context.namespaceId,
						id: runId as WorkflowRunId,
						revision: revisionWhenClaimed,
						signalSequence: 0,
					},
					updates: {
						attempts: 1,
						latestStateTransitionId: ulid(),
						onSignalSequenceMatch: { status, timeoutAt: null },
						onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
					},
				});

				expect(result).toEqual({ revision: revisionWhenClaimed + 1, signalSequence: 0 });
				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
					id: runId,
					revision: revisionWhenClaimed + 1,
					status,
				});
			}));

		test(`the matched ${status} update writes the timeout it was given`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId, revisionWhenClaimed } = await seedClaimedRun({
					namespaceRequestContext: context,
					repos,
					publisher,
				});
				const timeoutAt = 1_000_000 as TimestampMs;

				await repos.workflowRun.update({
					waitForSignal: true,
					filter: {
						namespaceId: context.namespaceId,
						id: runId as WorkflowRunId,
						revision: revisionWhenClaimed,
						signalSequence: 0,
					},
					updates: {
						attempts: 1,
						latestStateTransitionId: ulid(),
						onSignalSequenceMatch: { status, timeoutAt },
						onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
					},
				});

				expect(await listTimedOutRuns(repos, timeoutAt)).toEqual([
					expect.objectContaining({ id: runId, dueAt: timeoutAt }),
				]);
				expect(await listTimedOutRuns(repos, (timeoutAt - 1) as TimestampMs)).toEqual([]);
			}));

		test(`the matched ${status} without a timeout stores no due time`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId, revisionWhenClaimed } = await seedClaimedRun({
					namespaceRequestContext: context,
					repos,
					publisher,
				});

				await repos.workflowRun.update({
					waitForSignal: true,
					filter: {
						namespaceId: context.namespaceId,
						id: runId as WorkflowRunId,
						revision: revisionWhenClaimed,
						signalSequence: 0,
					},
					updates: {
						attempts: 1,
						latestStateTransitionId: ulid(),
						onSignalSequenceMatch: { status, timeoutAt: null },
						onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
					},
				});

				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
					id: runId,
					revision: revisionWhenClaimed + 1,
					status,
				});
				const endOfTime = 253_402_214_400_000 as TimestampMs; // 9999-12-31
				expect(await repos.workflowRun.listEventWaitTimedOutRuns(daemonContextFactory.build(), endOfTime, 10)).toEqual(
					[]
				);
			}));
	}

	test("the mismatched update writes the schedule it was given", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			await repos.workflowRun.incrementSignalSequence({
				namespaceId: context.namespaceId,
				id: runId as WorkflowRunId,
			});

			const scheduledAt = 2_000_000 as TimestampMs;

			await repos.workflowRun.update({
				waitForSignal: true,
				filter: {
					namespaceId: context.namespaceId,
					id: runId as WorkflowRunId,
					revision: revisionWhenClaimed,
					signalSequence: 0,
				},
				updates: {
					attempts: 1,
					latestStateTransitionId: ulid(),
					onSignalSequenceMatch: { status: "awaiting_event", timeoutAt: null },
					onSignalSequenceMismatch: { status: "scheduled", scheduledAt },
				},
			});

			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, scheduledAt, 10)).toEqual([
				expect.objectContaining({ id: runId, dueAt: scheduledAt }),
			]);
			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, (scheduledAt - 1) as TimestampMs, 10)).toEqual(
				[]
			);
		}));

	test("applies the mismatched update when the sequence has moved", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			await repos.workflowRun.incrementSignalSequence({
				namespaceId: context.namespaceId,
				id: runId as WorkflowRunId,
			});

			const result = await repos.workflowRun.update({
				waitForSignal: true,
				filter: {
					namespaceId: context.namespaceId,
					id: runId as WorkflowRunId,
					revision: revisionWhenClaimed,
					signalSequence: 0,
				},
				updates: {
					attempts: 1,
					latestStateTransitionId: ulid(),
					onSignalSequenceMatch: { status: "awaiting_event", timeoutAt: null },
					onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
				},
			});

			expect(result).toEqual({ revision: revisionWhenClaimed + 1, signalSequence: 1 });
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenClaimed + 1,
				status: "scheduled",
			});
		}));

	test("writes nothing when the revision has moved", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const result = await repos.workflowRun.update({
				waitForSignal: true,
				filter: {
					namespaceId: context.namespaceId,
					id: runId as WorkflowRunId,
					revision: revisionWhenClaimed - 1,
					signalSequence: 0,
				},
				updates: {
					attempts: 1,
					latestStateTransitionId: ulid(),
					onSignalSequenceMatch: { status: "awaiting_event", timeoutAt: null },
					onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
				},
			});

			expect(result).toBeNull();
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenClaimed,
				status: "running",
			});
		}));
});

describe("update without a signal sequence guard", () => {
	test("writes the schedule for a scheduled update", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const scheduledAt = 2_000_000 as TimestampMs;
			const { runId, revisionWhenParked } = await seedAwaitingEventRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ eventName: "orderShipped" }
			);

			const result = await repos.workflowRun.update({
				waitForSignal: false,
				filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId, revision: revisionWhenParked },
				updates: { status: "scheduled", attempts: 1, latestStateTransitionId: ulid(), scheduledAt },
			});

			expect(result).toEqual({ revision: revisionWhenParked + 1, signalSequence: 0 });

			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, scheduledAt, 10)).toEqual([
				expect.objectContaining({ id: runId, dueAt: scheduledAt }),
			]);
			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, (scheduledAt - 1) as TimestampMs, 10)).toEqual(
				[]
			);
		}));

	test("writes the wakeup for a sleeping update", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const wakeupAt = 3_000_000 as TimestampMs;
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const result = await repos.workflowRun.update({
				waitForSignal: false,
				filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId, revision: revisionWhenClaimed },
				updates: { status: "sleeping", attempts: 1, latestStateTransitionId: ulid(), wakeupAt },
			});

			expect(result).toEqual({ revision: revisionWhenClaimed + 1, signalSequence: 0 });

			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listSleepElapsedRuns(daemonContext, wakeupAt, 10)).toEqual([
				expect.objectContaining({ id: runId, dueAt: wakeupAt }),
			]);
			expect(await repos.workflowRun.listSleepElapsedRuns(daemonContext, (wakeupAt - 1) as TimestampMs, 10)).toEqual(
				[]
			);
		}));

	test("writes the next attempt for an awaiting_retry update", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const nextAttemptAt = 4_000_000 as TimestampMs;
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const result = await repos.workflowRun.update({
				waitForSignal: false,
				filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId, revision: revisionWhenClaimed },
				updates: { status: "awaiting_retry", attempts: 1, latestStateTransitionId: ulid(), nextAttemptAt },
			});

			expect(result).toEqual({ revision: revisionWhenClaimed + 1, signalSequence: 0 });

			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listRetryableRuns(daemonContext, nextAttemptAt, 10)).toEqual([
				expect.objectContaining({ id: runId, dueAt: nextAttemptAt }),
			]);
			expect(await repos.workflowRun.listRetryableRuns(daemonContext, (nextAttemptAt - 1) as TimestampMs, 10)).toEqual(
				[]
			);
		}));

	test("updates without a revision in the filter", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const result = await repos.workflowRun.update({
				waitForSignal: false,
				filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId },
				updates: { status: "paused", attempts: 1, latestStateTransitionId: ulid() },
			});

			expect(result).toEqual({ revision: revisionWhenClaimed + 1, signalSequence: 0 });
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenClaimed + 1,
				status: "paused",
			});
		}));
});

describe("incrementSignalSequence", () => {
	test("increments the sequence on each call and returns the run with its current state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const filter = { namespaceId: context.namespaceId, id: runId as WorkflowRunId };

			expect(await repos.workflowRun.incrementSignalSequence(filter)).toEqual({
				run: { status: "running", revision: revisionWhenClaimed, signalSequence: 1 },
				state: { status: "running" },
			});
			expect(await repos.workflowRun.incrementSignalSequence(filter)).toEqual({
				run: { status: "running", revision: revisionWhenClaimed, signalSequence: 2 },
				state: { status: "running" },
			});
		}));

	test("returns the state recorded by the run's latest transition", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenParked } = await seedAwaitingEventRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ eventName: "orderShipped" }
			);

			expect(
				await repos.workflowRun.incrementSignalSequence({
					namespaceId: context.namespaceId,
					id: runId as WorkflowRunId,
				})
			).toEqual({
				run: { status: "awaiting_event", revision: revisionWhenParked, signalSequence: 1 },
				state: { status: "awaiting_event", eventName: "orderShipped" },
			});
		}));

	test("returns null for an unknown run", () =>
		withHarness(async ({ context, repos }) => {
			expect(
				await repos.workflowRun.incrementSignalSequence({
					namespaceId: context.namespaceId,
					id: "run-missing" as WorkflowRunId,
				})
			).toBeNull();
		}));
});

// Seeds a claimed run with its ulid minted at the frozen `mintedAtMs` — later instants mint
// larger ids, pinning the id order the cursor walk depends on — then parks it on a child wait
// due at `timeoutAt`.
async function parkRunOnChildWait(
	deps: { context: NamespaceRequestContext; repos: Repositories; publisher: FakePublisher },
	params: { mintedAtMs: TimestampMs; timeoutAt: TimestampMs }
): Promise<string> {
	const { context, repos, publisher } = deps;
	const { runId, revisionWhenClaimed } = await withFakeClock(params.mintedAtMs, () =>
		seedClaimedRun({ namespaceRequestContext: context, repos, publisher })
	);

	await repos.workflowRun.update({
		waitForSignal: true,
		filter: {
			namespaceId: context.namespaceId,
			id: runId as WorkflowRunId,
			revision: revisionWhenClaimed,
			signalSequence: 0,
		},
		updates: {
			attempts: 1,
			latestStateTransitionId: ulid(),
			onSignalSequenceMatch: { status: "awaiting_child_workflow", timeoutAt: params.timeoutAt },
			onSignalSequenceMismatch: { status: "scheduled", scheduledAt: Date.now() as TimestampMs },
		},
	});

	return runId;
}

describe("listChildRunWaitTimedOutRuns cursor paging", () => {
	test("resumes past the frontier to later deadlines", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			const runA = await parkRunOnChildWait(deps, {
				mintedAtMs: 1_000 as TimestampMs,
				timeoutAt: 1_000_000 as TimestampMs,
			});
			const runB = await parkRunOnChildWait(deps, {
				mintedAtMs: 2_000 as TimestampMs,
				timeoutAt: 2_000_000 as TimestampMs,
			});
			const runC = await parkRunOnChildWait(deps, {
				mintedAtMs: 3_000 as TimestampMs,
				timeoutAt: 3_000_000 as TimestampMs,
			});

			const daemonContext = daemonContextFactory.build();
			const before = 3_000_000 as TimestampMs;

			expect(await repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContext, before, 2)).toEqual([
				expect.objectContaining({ id: runA, dueAt: 1_000_000 }),
				expect.objectContaining({ id: runB, dueAt: 2_000_000 }),
			]);

			expect(
				await repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContext, before, 2, {
					order: 2_000_000,
					id: runB,
					maxSeenId: runB,
				})
			).toEqual([expect.objectContaining({ id: runC, dueAt: 3_000_000 })]);
		}));

	test("splits deadline ties by id across pages", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			const sharedDeadline = 1_000_000 as TimestampMs;
			const runA = await parkRunOnChildWait(deps, { mintedAtMs: 1_000 as TimestampMs, timeoutAt: sharedDeadline });
			const runB = await parkRunOnChildWait(deps, { mintedAtMs: 2_000 as TimestampMs, timeoutAt: sharedDeadline });

			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContext, sharedDeadline, 1)).toEqual([
				expect.objectContaining({ id: runA, dueAt: sharedDeadline }),
			]);

			expect(
				await repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContext, sharedDeadline, 1, {
					order: sharedDeadline,
					id: runA,
					maxSeenId: runA,
				})
			).toEqual([expect.objectContaining({ id: runB, dueAt: sharedDeadline })]);
		}));

	test("returns a run behind the frontier when its id is newer than any seen", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { context, repos, publisher };
			// Already-walked bystander: due behind the frontier with an id below maxSeenId, so
			// the late-insert clause must not resurrect it.
			await parkRunOnChildWait(deps, { mintedAtMs: 1_000 as TimestampMs, timeoutAt: 1_000_000 as TimestampMs });
			const runB = await parkRunOnChildWait(deps, {
				mintedAtMs: 2_000 as TimestampMs,
				timeoutAt: 2_000_000 as TimestampMs,
			});
			// Minted after the walk passed its deadline: due behind the frontier, ulid above
			// maxSeenId — the late insert the third clause exists for.
			const lateRun = await parkRunOnChildWait(deps, {
				mintedAtMs: 3_000 as TimestampMs,
				timeoutAt: 1_500_000 as TimestampMs,
			});

			const daemonContext = daemonContextFactory.build();

			expect(
				await repos.workflowRun.listChildRunWaitTimedOutRuns(daemonContext, 3_000_000 as TimestampMs, 10, {
					order: 2_000_000,
					id: runB,
					maxSeenId: runB,
				})
			).toEqual([expect.objectContaining({ id: lateRun, dueAt: 1_500_000 })]);
		}));
});
