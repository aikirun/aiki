import { hashInput } from "@aikirun/lib/crypto";
import type { TimestampMs } from "@aikirun/lib/timestamp";
import type { FakePublisher } from "@aikirun/testing/infra/queue";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { WorkflowSource } from "@aikirun/types/workflow";
import type {
	TerminalWorkflowRunStatus,
	TimedWorkflowRunStatus,
	WaitingForSignalWorkflowRunStatus,
	WorkflowRunId,
	WorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import type { NamespaceRequestContext } from "../../../middleware/context";
import { createChildRunCanceller } from "../../../service/cancel-child-runs";
import { createWorkflowRunService } from "../../../service/workflow-run";
import { END_OF_TIME, withFakeClock } from "../../../testing/clock";
import { daemonContextFactory, namespaceRequestContextFactory } from "../../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../../testing/harness";
import { readWorkflowRunDueTimes } from "../../../testing/infra/db/workflow-run";
import {
	type SeedRunDeps,
	seedAwaitingChildRun,
	seedAwaitingEventRun,
	seedAwaitingRetryRun,
	seedCancelledRun,
	seedClaimedRun,
	seedCompletedRun,
	seedFailedRun,
	seedPausedRun,
	seedQueuedRun,
	seedScheduledRun,
	seedSleepingRun,
	seedStalledRun,
} from "../../../testing/seed/run";
import { seedActiveSchedule, seedRunFromSchedule } from "../../../testing/seed/schedule";
import { seedAwaitingTaskRetryRun } from "../../../testing/seed/task";
import type { Repositories } from "../types";
import type { DueWorkflowRun } from "../types/workflow-run";

const withHarness = createServiceHarness();

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

const NO_DUE_TIMES = { scheduledAt: null, wakeupAt: null, timeoutAt: null, nextAttemptAt: null };

function orderById<T extends { id: string }>(a: T, b: T): number {
	return a.id < b.id ? -1 : 1;
}

async function getRunRow(repos: Repositories, namespaceId: NamespaceId, runId: string) {
	const row = await repos.workflowRun.getById({ namespaceId, id: runId });
	if (!row) {
		throw new Error(`Run not found: ${runId}`);
	}
	return row;
}

async function getWorkflowId(
	repos: Repositories,
	namespaceId: NamespaceId,
	workflow: { name: string; versionId: string; source: WorkflowSource }
) {
	const row = await repos.workflow.getByNameAndVersion(namespaceId, workflow);
	if (!row) {
		throw new Error(`Workflow not found: ${workflow.source}:${workflow.name}:${workflow.versionId}`);
	}
	return row.id;
}

type RunSeed = (deps: SeedRunDeps & { publisher: FakePublisher }) => Promise<{ runId: string }>;

/** One run per status, each reached through the paths production takes. */
const seedRunByStatus: Record<WorkflowRunStatus, RunSeed> = {
	scheduled: (deps) => seedScheduledRun(deps),
	queued: (deps) => seedQueuedRun(deps),
	running: (deps) => seedClaimedRun(deps),
	paused: (deps) => seedPausedRun(deps),
	sleeping: (deps) => seedSleepingRun(deps, { sleepName: "cooldown", durationMs: 60_000 }),
	awaiting_event: (deps) => seedAwaitingEventRun(deps, { eventName: "orderShipped" }),
	awaiting_retry: (deps) => seedAwaitingRetryRun(deps, { nextAttemptAt: 4_000_000 }),
	awaiting_task_retry: (deps) => seedAwaitingTaskRetryRun(deps, { nextAttemptAt: 4_000_000 }),
	awaiting_child_workflow: (deps) => seedAwaitingChildRun(deps),
	stalled: (deps) => seedStalledRun(deps),
	cancelled: (deps) => seedCancelledRun(deps),
	completed: (deps) => seedCompletedRun(deps),
	failed: (deps) => seedFailedRun(deps),
};

function runSeedsForStatusesOtherThan(status: WorkflowRunStatus) {
	return Object.entries(seedRunByStatus).filter(([seededStatus]) => seededStatus !== status);
}

describe("getByIdWithState", () => {
	test("returns a completed state carrying the output key", () =>
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

			expect(row?.state).toHaveProperty("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));
});

describe("getByIdWithWorkflowAndState", () => {
	test("returns the run's workflow and a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, workflowName, workflowVersionId, workflowSource } = await seedCompletedRun(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.workflowRun.getByIdWithWorkflowAndState({ namespaceId: context.namespaceId, id: runId });

			expect(row?.workflow).toEqual({ name: workflowName, versionId: workflowVersionId, source: workflowSource });
			expect(row?.state).toHaveProperty("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));
});

describe("getByReferenceWithWorkflowAndState", () => {
	test("returns a completed state carrying the output key", () =>
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

			expect(row?.state).toHaveProperty("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));

	test("matches the reference under the requested workflow version only", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const referenceId = "order-7-ref";
			const runUnderV2 = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { reference: { id: referenceId } } }
			);
			const workflowRunService = createWorkflowRunService({ repos, childRunCanceller: createChildRunCanceller() });
			const input = { orderId: "order-7" };
			const underV3RunId = await workflowRunService.createWorkflowRun(context, {
				name: runUnderV2.workflowName,
				versionId: "v3",
				input: asOpaquePayload(input),
				inputHash: { value: await hashInput(input) },
				clientHasherApplied: false,
				clientCodecApplied: false,
				options: { reference: { id: referenceId } },
			});
			const getReferencedRunUnderVersion = (versionId: string) =>
				repos.workflowRun.getByReferenceWithWorkflowAndState({
					namespaceId: context.namespaceId,
					name: runUnderV2.workflowName,
					versionId,
					source: runUnderV2.workflowSource,
					referenceId,
				});

			expect(await getReferencedRunUnderVersion(runUnderV2.workflowVersionId)).toEqual(
				expect.objectContaining({ run: expect.objectContaining({ id: runUnderV2.runId, referenceId }) })
			);
			expect(await getReferencedRunUnderVersion("v3")).toEqual(
				expect.objectContaining({ run: expect.objectContaining({ id: underV3RunId, referenceId }) })
			);
			expect(await getReferencedRunUnderVersion("v9")).toBeNull();
		}));
});

describe("exists", () => {
	test("finds a run in its namespace, and not from another namespace or for an unknown id", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedScheduledRun({ repos, namespaceRequestContext: context });
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;
			const absentRunId = ulid();

			expect(await repos.workflowRun.exists(context.namespaceId, runId)).toBe(true);
			expect(await repos.workflowRun.exists(otherNamespaceId, runId)).toBe(false);
			expect(await repos.workflowRun.exists(context.namespaceId, absentRunId)).toBe(false);
		}));
});

describe("update", () => {
	describe("guarded on the signal sequence", () => {
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
					expect(await listTimedOutRuns(repos, END_OF_TIME)).toEqual([]);
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
				expect(
					await repos.workflowRun.listDueScheduleRuns(daemonContext, (scheduledAt - 1) as TimestampMs, 10)
				).toEqual([]);
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

		test("the matched update keeps only the timeout it was given", () =>
			withHarness(async ({ context, db, repos, publisher }) => {
				const { runId, revisionWhenAsleep, wakeupAt } = await seedSleepingRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ sleepName: "cooldown", durationMs: 60_000 }
				);
				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });
				const timeoutAt = 1_000_000 as TimestampMs;

				await repos.workflowRun.update({
					waitForSignal: true,
					filter: {
						namespaceId: context.namespaceId,
						id: runId as WorkflowRunId,
						revision: revisionWhenAsleep,
						signalSequence: 0,
					},
					updates: {
						attempts: 1,
						latestStateTransitionId: ulid(),
						onSignalSequenceMatch: { status: "awaiting_event", timeoutAt },
						onSignalSequenceMismatch: { status: "scheduled", scheduledAt: 2_000_000 as TimestampMs },
					},
				});

				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, timeoutAt });
			}));

		test("the mismatched update keeps only the schedule it was given", () =>
			withHarness(async ({ context, db, repos, publisher }) => {
				const { runId, revisionWhenAsleep, wakeupAt } = await seedSleepingRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ sleepName: "cooldown", durationMs: 60_000 }
				);
				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });
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
						revision: revisionWhenAsleep,
						signalSequence: 0,
					},
					updates: {
						attempts: 1,
						latestStateTransitionId: ulid(),
						onSignalSequenceMatch: { status: "awaiting_event", timeoutAt: 1_000_000 as TimestampMs },
						onSignalSequenceMismatch: { status: "scheduled", scheduledAt },
					},
				});

				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, scheduledAt });
			}));
	});

	describe("without a signal sequence guard", () => {
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
				expect(
					await repos.workflowRun.listDueScheduleRuns(daemonContext, (scheduledAt - 1) as TimestampMs, 10)
				).toEqual([]);
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
				expect(
					await repos.workflowRun.listRetryableRuns(daemonContext, (nextAttemptAt - 1) as TimestampMs, 10)
				).toEqual([]);
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

		test("keeps only the due time the new status carries", () =>
			withHarness(async ({ context, db, repos, publisher }) => {
				const { runId, revisionWhenAsleep, wakeupAt } = await seedSleepingRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ sleepName: "cooldown", durationMs: 60_000 }
				);
				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });
				const nextAttemptAt = 4_000_000 as TimestampMs;

				await repos.workflowRun.update({
					waitForSignal: false,
					filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId, revision: revisionWhenAsleep },
					updates: { status: "awaiting_retry", attempts: 1, latestStateTransitionId: ulid(), nextAttemptAt },
				});

				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, nextAttemptAt });
			}));

		test("clears every due time when the new status carries none", () =>
			withHarness(async ({ context, db, repos, publisher }) => {
				const { runId, revisionWhenAsleep, wakeupAt } = await seedSleepingRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ sleepName: "cooldown", durationMs: 60_000 }
				);
				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });

				await repos.workflowRun.update({
					waitForSignal: false,
					filter: { namespaceId: context.namespaceId, id: runId as WorkflowRunId, revision: revisionWhenAsleep },
					updates: { status: "paused", attempts: 1, latestStateTransitionId: ulid() },
				});

				expect(await readWorkflowRunDueTimes(db, runId)).toEqual(NO_DUE_TIMES);
			}));
	});
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
			const absentRunId = ulid();

			expect(
				await repos.workflowRun.incrementSignalSequence({
					namespaceId: context.namespaceId,
					id: absentRunId as WorkflowRunId,
				})
			).toBeNull();
		}));
});

describe("bulkIncrementSignalSequence", () => {
	test("bumps the sequence of each listed run and returns each run's options", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const prioritized = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { priority: 2 } }
			);
			const plain = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			const rows = await repos.workflowRun.bulkIncrementSignalSequence([
				{ namespaceId: context.namespaceId, id: prioritized.runId as WorkflowRunId },
				{ namespaceId: context.namespaceId, id: plain.runId as WorkflowRunId },
			]);

			rows.sort((a, b) => (a.id < b.id ? -1 : 1));
			expect(rows).toEqual([
				expect.objectContaining({
					id: prioritized.runId,
					status: "running",
					revision: prioritized.revisionWhenClaimed,
					signalSequence: 1,
					options: { priority: 2 },
				}),
				expect.objectContaining({
					id: plain.runId,
					status: "running",
					revision: plain.revisionWhenClaimed,
					signalSequence: 1,
					options: null,
				}),
			]);
		}));
});

describe("listDueByIdsAndStatus", () => {
	test("lists the given runs in the status from any namespace and ignores the others", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const otherNamespaceContext = namespaceRequestContextFactory.build();
			const runningRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const scheduledRun = await seedScheduledRun({ repos, namespaceRequestContext: context });
			const scheduledRunInOtherNamespace = await seedScheduledRun({
				repos,
				namespaceRequestContext: otherNamespaceContext,
			});
			const absentRunId = ulid();

			const rows = await repos.workflowRun.listDueByIdsAndStatus(daemonContextFactory.build(), {
				ids: [runningRun.runId, scheduledRun.runId, scheduledRunInOtherNamespace.runId, absentRunId],
				status: "scheduled",
				dueBy: END_OF_TIME,
			});

			expect([...rows].sort(orderById)).toEqual(
				[
					{
						id: scheduledRun.runId,
						namespaceId: context.namespaceId,
						revision: scheduledRun.revisionWhenScheduled,
						attempts: scheduledRun.attemptsWhenScheduled,
					},
					{
						id: scheduledRunInOtherNamespace.runId,
						namespaceId: otherNamespaceContext.namespaceId,
						revision: scheduledRunInOtherNamespace.revisionWhenScheduled,
						attempts: scheduledRunInOtherNamespace.attemptsWhenScheduled,
					},
				]
					.sort(orderById)
					.map((run) => expect.objectContaining(run))
			);
		}));

	describe("due time", () => {
		const parkedAt = 1_000 as TimestampMs;
		const dueAt = 4_000_000 as TimestampMs;

		/** One run per status that waits on a due time, each seeded so that its due time is `dueAt`. */
		const dueRunCaseByStatus = {
			scheduled: {
				status: "scheduled",
				seedRun: (deps) => withFakeClock(dueAt, () => seedScheduledRun(deps)),
			},
			sleeping: {
				status: "sleeping",
				seedRun: (deps) =>
					withFakeClock(parkedAt, () => seedSleepingRun(deps, { sleepName: "cooldown", durationMs: dueAt - parkedAt })),
			},
			awaiting_retry: {
				status: "awaiting_retry",
				seedRun: (deps) => seedAwaitingRetryRun(deps, { nextAttemptAt: dueAt }),
			},
			awaiting_task_retry: {
				status: "awaiting_task_retry",
				seedRun: (deps) => seedAwaitingTaskRetryRun(deps, { nextAttemptAt: dueAt }),
			},
			awaiting_event: {
				status: "awaiting_event",
				seedRun: (deps) =>
					withFakeClock(parkedAt, () =>
						seedAwaitingEventRun(deps, { eventName: "orderShipped", timeoutInMs: dueAt - parkedAt })
					),
			},
			awaiting_child_workflow: {
				status: "awaiting_child_workflow",
				seedRun: (deps) => withFakeClock(parkedAt, () => seedAwaitingChildRun(deps, { timeoutInMs: dueAt - parkedAt })),
			},
		} satisfies { [Status in TimedWorkflowRunStatus]: { status: Status; seedRun: RunSeed } };

		for (const { status, seedRun } of Object.values(dueRunCaseByStatus)) {
			test(`lists a run in ${status} due at the cutoff and leaves it out a millisecond earlier`, () =>
				withHarness(async ({ context, repos, publisher }) => {
					const { runId } = await seedRun({ namespaceRequestContext: context, repos, publisher });
					const daemonContext = daemonContextFactory.build();

					expect(
						await repos.workflowRun.listDueByIdsAndStatus(daemonContext, { ids: [runId], status, dueBy: dueAt })
					).toEqual([expect.objectContaining({ id: runId })]);
					expect(
						await repos.workflowRun.listDueByIdsAndStatus(daemonContext, {
							ids: [runId],
							status,
							dueBy: (dueAt - 1) as TimestampMs,
						})
					).toEqual([]);
				}));
		}

		/** The two waits that can be parked with no deadline at all. */
		const waitWithoutDeadlineCaseByStatus = {
			awaiting_event: {
				status: "awaiting_event",
				seedRun: (deps) => seedAwaitingEventRun(deps, { eventName: "orderShipped" }),
			},
			awaiting_child_workflow: {
				status: "awaiting_child_workflow",
				seedRun: (deps) => seedAwaitingChildRun(deps),
			},
		} satisfies { [Status in WaitingForSignalWorkflowRunStatus]: { status: Status; seedRun: RunSeed } };

		for (const { status, seedRun } of Object.values(waitWithoutDeadlineCaseByStatus)) {
			test(`never lists a run in ${status} parked without a deadline`, () =>
				withHarness(async ({ context, repos, publisher }) => {
					const { runId } = await seedRun({ namespaceRequestContext: context, repos, publisher });

					expect(
						await repos.workflowRun.listDueByIdsAndStatus(daemonContextFactory.build(), {
							ids: [runId],
							status,
							dueBy: END_OF_TIME,
						})
					).toEqual([]);
				}));
		}
	});
});

describe("getChildRuns", () => {
	test("lists the parent's children with their options", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const childOfParent = {
				parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed },
			};
			const pooledChildRun = await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{ ...childOfParent, options: { pool: "warehouse-eu" } }
			);
			const plainChildRun = await seedScheduledRun({ repos, namespaceRequestContext: context }, childOfParent);
			await seedScheduledRun({ repos, namespaceRequestContext: context });

			const rows = await repos.workflowRun.getChildRuns({ namespaceId: context.namespaceId, id: parentRun.runId });

			expect([...rows].sort(orderById)).toEqual(
				[
					{ id: pooledChildRun.runId, options: { pool: "warehouse-eu" } },
					{ id: plainChildRun.runId, options: null },
				].sort(orderById)
			);
		}));

	test("narrows to children in the given statuses", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const childOfParent = {
				parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed },
			};
			const runningChildRun = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				childOfParent
			);
			await seedScheduledRun({ repos, namespaceRequestContext: context }, childOfParent);

			const rows = await repos.workflowRun.getChildRuns({
				namespaceId: context.namespaceId,
				id: parentRun.runId,
				childRunStatus: ["running"],
			});

			expect(rows).toEqual([{ id: runningChildRun.runId, options: null }]);
		}));
});

describe("getChildRunsWithWorkflow", () => {
	test("lists the parent's children with their workflow, input hash and reference", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const childRun = await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{
					parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed },
					options: { reference: { id: "order-7-child" } },
				}
			);

			expect(
				await repos.workflowRun.getChildRunsWithWorkflow({ namespaceId: context.namespaceId, id: parentRun.runId })
			).toEqual([
				{
					run: { id: childRun.runId, inputHash: childRun.inputHash, referenceId: "order-7-child" },
					workflow: { name: parentRun.workflowName, versionId: parentRun.workflowVersionId },
				},
			]);
		}));
});

describe("hasChildRuns", () => {
	test("reports which of the given runs have children", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{ parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed } }
			);
			const childlessRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			expect(await repos.workflowRun.hasChildRuns([{ id: parentRun.runId }, { id: childlessRun.runId }])).toEqual(
				new Set([parentRun.runId])
			);
		}));

	test("counts only children in the given statuses", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{ parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed } }
			);

			expect(await repos.workflowRun.hasChildRuns([{ id: parentRun.runId }], ["running"])).toEqual(new Set());
			expect(await repos.workflowRun.hasChildRuns([{ id: parentRun.runId }], ["scheduled"])).toEqual(
				new Set([parentRun.runId])
			);
		}));
});

describe("getByWorkflowAndReferenceId", () => {
	test("finds the run by workflow and reference in its namespace only", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const referenceId = "order-7-ref";
			const { runId, workflowName, workflowVersionId, workflowSource } = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { reference: { id: referenceId } } }
			);
			const workflowId = await getWorkflowId(repos, context.namespaceId, {
				name: workflowName,
				versionId: workflowVersionId,
				source: workflowSource,
			});
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;
			const absentWorkflowId = ulid();

			expect(
				await repos.workflowRun.getByWorkflowAndReferenceId({
					namespaceId: context.namespaceId,
					workflowId,
					referenceId,
				})
			).toEqual(expect.objectContaining({ id: runId }));
			expect(
				await repos.workflowRun.getByWorkflowAndReferenceId({
					namespaceId: context.namespaceId,
					workflowId,
					referenceId: "order-8-ref",
				})
			).toBeNull();
			expect(
				await repos.workflowRun.getByWorkflowAndReferenceId({
					namespaceId: context.namespaceId,
					workflowId: absentWorkflowId,
					referenceId,
				})
			).toBeNull();
			expect(
				await repos.workflowRun.getByWorkflowAndReferenceId({ namespaceId: otherNamespaceId, workflowId, referenceId })
			).toBeNull();
		}));
});

describe("listByWorkflowAndReferenceIdPairs", () => {
	test("lists the runs matching any of the pairs", () =>
		withHarness(async ({ context, repos }) => {
			const seedReferencedRun = (referenceId: string) =>
				seedScheduledRun({ repos, namespaceRequestContext: context }, { options: { reference: { id: referenceId } } });
			const order7Run = await seedReferencedRun("order-7-ref");
			const order8Run = await seedReferencedRun("order-8-ref");
			await seedReferencedRun("order-9-ref");
			const workflowId = await getWorkflowId(repos, context.namespaceId, {
				name: "ship-orders",
				versionId: "v2",
				source: "user",
			});

			const rows = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({
				pairs: [
					{ namespaceId: context.namespaceId, workflowId, referenceId: "order-7-ref" },
					{ namespaceId: context.namespaceId, workflowId, referenceId: "order-8-ref" },
				],
			});

			expect([...rows].sort(orderById)).toEqual(
				[
					{ id: order7Run.runId, workflowId, referenceId: "order-7-ref", attempts: 1, options: {} },
					{ id: order8Run.runId, workflowId, referenceId: "order-8-ref", attempts: 1, options: {} },
				].sort(orderById)
			);
		}));

	test("narrows to the given statuses", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const runningRun = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { reference: { id: "order-7-ref" } } }
			);
			await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{ options: { reference: { id: "order-8-ref" } } }
			);
			const workflowId = await getWorkflowId(repos, context.namespaceId, {
				name: runningRun.workflowName,
				versionId: runningRun.workflowVersionId,
				source: runningRun.workflowSource,
			});

			const rows = await repos.workflowRun.listByWorkflowAndReferenceIdPairs({
				pairs: [
					{ namespaceId: context.namespaceId, workflowId, referenceId: "order-7-ref" },
					{ namespaceId: context.namespaceId, workflowId, referenceId: "order-8-ref" },
				],
				status: ["running"],
			});

			expect(rows).toEqual([expect.objectContaining({ id: runningRun.runId, referenceId: "order-7-ref" })]);
		}));
});

describe("listByFilters", () => {
	test("lists the namespace's runs by id in the requested order, with their workflow and the total", () =>
		withHarness(async ({ context, repos }) => {
			const base = Date.now();
			const olderRun = await withFakeClock(base, () => seedScheduledRun({ repos, namespaceRequestContext: context }));
			const newerRun = await withFakeClock(base + 1, () =>
				seedScheduledRun({ repos, namespaceRequestContext: context })
			);
			await seedScheduledRun({ repos, namespaceRequestContext: namespaceRequestContextFactory.build() });
			const expectedRow = (runId: string) =>
				expect.objectContaining({
					id: runId,
					status: "scheduled",
					referenceId: null,
					name: "ship-orders",
					versionId: "v2",
				});

			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId }, 10, 0, { order: "asc" })
			).toEqual({ rows: [expectedRow(olderRun.runId), expectedRow(newerRun.runId)], total: 2 });
			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId }, 10, 0, { order: "desc" })
			).toEqual({ rows: [expectedRow(newerRun.runId), expectedRow(olderRun.runId)], total: 2 });
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos }) => {
			const base = Date.now();
			await withFakeClock(base, () => seedScheduledRun({ repos, namespaceRequestContext: context }));
			const newerRun = await withFakeClock(base + 1, () =>
				seedScheduledRun({ repos, namespaceRequestContext: context })
			);
			await withFakeClock(base + 2, () => seedScheduledRun({ repos, namespaceRequestContext: context }));

			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId }, 1, 1, { order: "asc" })
			).toEqual({ rows: [expect.objectContaining({ id: newerRun.runId })], total: 3 });
		}));

	test("narrows to the given statuses", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const runningRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			await seedScheduledRun({ repos, namespaceRequestContext: context });

			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId, status: ["running"] }, 10, 0, {
					order: "asc",
				})
			).toEqual({ rows: [expect.objectContaining({ id: runningRun.runId, status: "running" })], total: 1 });
		}));

	test("narrows to the given workflows and, within them, to the given reference", () =>
		withHarness(async ({ context, repos }) => {
			const referencedRun = await seedScheduledRun(
				{ repos, namespaceRequestContext: context },
				{ options: { reference: { id: "order-7-ref" } } }
			);
			await seedScheduledRun({ repos, namespaceRequestContext: context });
			const workflowId = await getWorkflowId(repos, context.namespaceId, {
				name: "ship-orders",
				versionId: "v2",
				source: "user",
			});
			const absentWorkflowId = ulid();

			expect(
				await repos.workflowRun.listByFilters(
					{ namespaceId: context.namespaceId, workflow: { ids: [workflowId], referenceId: "order-7-ref" } },
					10,
					0,
					{ order: "asc" }
				)
			).toEqual({
				rows: [expect.objectContaining({ id: referencedRun.runId, referenceId: "order-7-ref" })],
				total: 1,
			});
			expect(
				await repos.workflowRun.listByFilters(
					{ namespaceId: context.namespaceId, workflow: { ids: [absentWorkflowId] } },
					10,
					0,
					{ order: "asc" }
				)
			).toEqual({ rows: [], total: 0 });
		}));

	test("narrows to the given id", () =>
		withHarness(async ({ context, repos }) => {
			const wantedRun = await seedScheduledRun({ repos, namespaceRequestContext: context });
			await seedScheduledRun({ repos, namespaceRequestContext: context });

			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId, id: wantedRun.runId }, 10, 0, {
					order: "asc",
				})
			).toEqual({ rows: [expect.objectContaining({ id: wantedRun.runId })], total: 1 });
		}));

	test("narrows to the runs the given schedule created", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const { runId } = await seedRunFromSchedule({ repos, namespaceRequestContext: context }, { schedule });
			await seedScheduledRun({ repos, namespaceRequestContext: context });

			expect(
				await repos.workflowRun.listByFilters({ namespaceId: context.namespaceId, scheduleId: schedule.id }, 10, 0, {
					order: "asc",
				})
			).toEqual({
				rows: [
					expect.objectContaining({
						id: runId,
						status: "queued",
						name: schedule.workflowName,
						versionId: schedule.workflowVersionId,
					}),
				],
				total: 1,
			});
		}));
});

describe("listTaskRetryableRuns", () => {
	test("lists a run parked on a task retry due at the cutoff and skips one due after it", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const nextAttemptAt = 4_000_000 as TimestampMs;
			const { runId } = await seedAwaitingTaskRetryRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ nextAttemptAt }
			);
			const daemonContext = daemonContextFactory.build();

			expect(await repos.workflowRun.listTaskRetryableRuns(daemonContext, nextAttemptAt, 10)).toEqual([
				expect.objectContaining({ id: runId, dueAt: nextAttemptAt }),
			]);
			expect(
				await repos.workflowRun.listTaskRetryableRuns(daemonContext, (nextAttemptAt - 1) as TimestampMs, 10)
			).toEqual([]);
		}));
});

describe("listChildRunWaitTimedOutRuns", () => {
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

describe("getRunCount", () => {
	test("counts the schedule's runs in the namespace", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			await seedRunFromSchedule({ repos, namespaceRequestContext: context }, { schedule });
			await seedScheduledRun({ repos, namespaceRequestContext: context });
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.workflowRun.getRunCount(context.namespaceId, schedule.id)).toBe(1);
			expect(await repos.workflowRun.getRunCount(otherNamespaceId, schedule.id)).toBe(0);
		}));
});

describe("getRunCounts", () => {
	test("counts each schedule's runs and omits schedules without runs", () =>
		withHarness(async ({ context, repos }) => {
			const scheduleWithRun = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			await seedRunFromSchedule({ repos, namespaceRequestContext: context }, { schedule: scheduleWithRun.schedule });
			const scheduleWithoutRun = await seedActiveSchedule(
				{ repos, namespaceRequestContext: context },
				{ workflowName: "send-reminders" }
			);

			expect(
				await repos.workflowRun.getRunCounts(context.namespaceId, [
					scheduleWithRun.schedule.id,
					scheduleWithoutRun.schedule.id,
				])
			).toEqual(new Map([[scheduleWithRun.schedule.id, 1]]));
		}));
});

describe("bulkTransitionToQueued", () => {
	test("queues the runs whose expected revision matches, points them at their transition, and returns their ids and revisions", () =>
		withHarness(async ({ context, repos }) => {
			const matchedRun = await seedScheduledRun({ repos, namespaceRequestContext: context });
			const staleRevisionRun = await seedScheduledRun({ repos, namespaceRequestContext: context });
			const staleRowBefore = await getRunRow(repos, context.namespaceId, staleRevisionRun.runId);
			const transitionId = ulid();
			await repos.stateTransition.append({
				id: transitionId,
				workflowRunId: matchedRun.runId,
				type: "workflow_run",
				attempt: matchedRun.attemptsWhenScheduled,
				revision: matchedRun.revisionWhenScheduled + 1,
				state: { status: "queued", reason: "new" },
			});

			const queuedRuns = await repos.workflowRun.bulkTransitionToQueued(daemonContextFactory.build(), "scheduled", [
				{
					filter: { id: matchedRun.runId, revision: matchedRun.revisionWhenScheduled },
					update: { stateTransitionId: transitionId },
				},
				{
					filter: { id: staleRevisionRun.runId, revision: staleRevisionRun.revisionWhenScheduled - 1 },
					update: { stateTransitionId: ulid() },
				},
			]);

			expect(queuedRuns).toEqual([{ id: matchedRun.runId, revision: matchedRun.revisionWhenScheduled + 1 }]);
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: matchedRun.runId })
			).toEqual({
				run: expect.objectContaining({
					id: matchedRun.runId,
					status: "queued",
					revision: matchedRun.revisionWhenScheduled + 1,
					attempts: matchedRun.attemptsWhenScheduled,
					latestStateTransitionId: transitionId,
				}),
				state: { status: "queued", reason: "new" },
			});
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: staleRevisionRun.runId })).toEqual(
				staleRowBefore
			);
		}));

	test("charges an attempt when asked", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const nextAttemptAt = 4_000_000;
			const { runId, revisionWhenParked, attemptsWhenClaimed } = await seedAwaitingRetryRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ nextAttemptAt }
			);
			const transitionId = ulid();
			await repos.stateTransition.append({
				id: transitionId,
				workflowRunId: runId,
				type: "workflow_run",
				attempt: attemptsWhenClaimed + 1,
				revision: revisionWhenParked + 1,
				state: { status: "queued", reason: "retry" },
			});

			const queuedRuns = await repos.workflowRun.bulkTransitionToQueued(
				daemonContextFactory.build(),
				"awaiting_retry",
				[{ filter: { id: runId, revision: revisionWhenParked }, update: { stateTransitionId: transitionId } }],
				{ incrementAttempts: true }
			);

			expect(queuedRuns).toEqual([{ id: runId, revision: revisionWhenParked + 1 }]);
			expect(await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId })).toEqual({
				run: expect.objectContaining({
					id: runId,
					status: "queued",
					revision: revisionWhenParked + 1,
					attempts: attemptsWhenClaimed + 1,
				}),
				state: { status: "queued", reason: "retry" },
			});
		}));

	test("moves a run from the status it is told to move from", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenAsleep } = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);

			const queuedRuns = await repos.workflowRun.bulkTransitionToQueued(daemonContextFactory.build(), "sleeping", [
				{ filter: { id: runId, revision: revisionWhenAsleep }, update: { stateTransitionId: ulid() } },
			]);

			expect(queuedRuns).toEqual([{ id: runId, revision: revisionWhenAsleep + 1 }]);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenAsleep + 1,
				status: "queued",
			});
		}));

	test("clears the due time of the runs it queues", () =>
		withHarness(async ({ context, db, repos, publisher }) => {
			const { runId, revisionWhenAsleep, wakeupAt } = await seedSleepingRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ sleepName: "cooldown", durationMs: 60_000 }
			);
			expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });

			await repos.workflowRun.bulkTransitionToQueued(daemonContextFactory.build(), "sleeping", [
				{ filter: { id: runId, revision: revisionWhenAsleep }, update: { stateTransitionId: ulid() } },
			]);

			expect(await readWorkflowRunDueTimes(db, runId)).toEqual(NO_DUE_TIMES);
		}));

	for (const [status, seedRun] of runSeedsForStatusesOtherThan("scheduled")) {
		test(`leaves a ${status} run alone when moving from scheduled`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ repos, namespaceRequestContext: context, publisher });
				const rowBefore = await getRunRow(repos, context.namespaceId, runId);
				expect(rowBefore).toEqual(expect.objectContaining({ status }));

				const queuedRuns = await repos.workflowRun.bulkTransitionToQueued(daemonContextFactory.build(), "scheduled", [
					{ filter: { id: runId, revision: rowBefore.revision }, update: { stateTransitionId: ulid() } },
				]);

				expect(queuedRuns).toEqual([]);
				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
			}));
	}
});

describe("bulkTransitionToScheduled", () => {
	test("schedules the parked runs whose expected revision matches at the given time and returns their ids", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const scheduledAt = 2_000_000 as TimestampMs;
			const matchedRun = await seedAwaitingEventRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ eventName: "orderShipped" }
			);
			const staleRevisionRun = await seedAwaitingEventRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ eventName: "orderShipped" }
			);
			const staleRowBefore = await getRunRow(repos, context.namespaceId, staleRevisionRun.runId);
			const transitionId = ulid();
			await repos.stateTransition.append({
				id: transitionId,
				workflowRunId: matchedRun.runId,
				type: "workflow_run",
				attempt: matchedRun.attemptsWhenClaimed,
				revision: matchedRun.revisionWhenParked + 1,
				state: { status: "scheduled", reason: "event", scheduledAt },
			});

			const scheduledIds = await repos.workflowRun.bulkTransitionToScheduled("awaiting_event", scheduledAt, [
				{
					filter: {
						namespaceId: context.namespaceId,
						id: matchedRun.runId,
						revision: matchedRun.revisionWhenParked,
					},
					update: { stateTransitionId: transitionId },
				},
				{
					filter: {
						namespaceId: context.namespaceId,
						id: staleRevisionRun.runId,
						revision: staleRevisionRun.revisionWhenParked - 1,
					},
					update: { stateTransitionId: ulid() },
				},
			]);

			expect(scheduledIds).toEqual([matchedRun.runId]);
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: matchedRun.runId })
			).toEqual({
				run: expect.objectContaining({
					id: matchedRun.runId,
					status: "scheduled",
					revision: matchedRun.revisionWhenParked + 1,
					latestStateTransitionId: transitionId,
				}),
				state: { status: "scheduled", reason: "event", scheduledAt },
			});
			const daemonContext = daemonContextFactory.build();
			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, scheduledAt, 10)).toEqual([
				expect.objectContaining({ id: matchedRun.runId, dueAt: scheduledAt }),
			]);
			expect(await repos.workflowRun.listDueScheduleRuns(daemonContext, (scheduledAt - 1) as TimestampMs, 10)).toEqual(
				[]
			);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: staleRevisionRun.runId })).toEqual(
				staleRowBefore
			);
		}));

	test("leaves a run alone when the namespace does not match", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenParked } = await seedAwaitingEventRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ eventName: "orderShipped" }
			);
			const rowBefore = await getRunRow(repos, context.namespaceId, runId);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			const scheduledIds = await repos.workflowRun.bulkTransitionToScheduled(
				"awaiting_event",
				2_000_000 as TimestampMs,
				[
					{
						filter: { namespaceId: otherNamespaceId, id: runId, revision: revisionWhenParked },
						update: { stateTransitionId: ulid() },
					},
				]
			);

			expect(scheduledIds).toEqual([]);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
		}));

	test("moves a run from the status it is told to move from", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenParked } = await seedAwaitingChildRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const scheduledIds = await repos.workflowRun.bulkTransitionToScheduled(
				"awaiting_child_workflow",
				2_000_000 as TimestampMs,
				[
					{
						filter: { namespaceId: context.namespaceId, id: runId, revision: revisionWhenParked },
						update: { stateTransitionId: ulid() },
					},
				]
			);

			expect(scheduledIds).toEqual([runId]);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenParked + 1,
				status: "scheduled",
			});
		}));

	test("keeps only the schedule it was given", () =>
		withHarness(async ({ context, db, repos, publisher }) => {
			const timeoutAt = 1_000_000 as TimestampMs;
			const runId = await parkRunOnChildWait(
				{ context, repos, publisher },
				{ mintedAtMs: Date.now() as TimestampMs, timeoutAt }
			);
			const { revision } = await getRunRow(repos, context.namespaceId, runId);
			expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, timeoutAt });
			const scheduledAt = 2_000_000 as TimestampMs;

			await repos.workflowRun.bulkTransitionToScheduled("awaiting_child_workflow", scheduledAt, [
				{ filter: { namespaceId: context.namespaceId, id: runId, revision }, update: { stateTransitionId: ulid() } },
			]);

			expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, scheduledAt });
		}));

	for (const [status, seedRun] of runSeedsForStatusesOtherThan("awaiting_event")) {
		test(`leaves a ${status} run alone when moving from awaiting_event`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ repos, namespaceRequestContext: context, publisher });
				const rowBefore = await getRunRow(repos, context.namespaceId, runId);
				expect(rowBefore).toEqual(expect.objectContaining({ status }));

				const scheduledIds = await repos.workflowRun.bulkTransitionToScheduled(
					"awaiting_event",
					2_000_000 as TimestampMs,
					[
						{
							filter: { namespaceId: context.namespaceId, id: runId, revision: rowBefore.revision },
							update: { stateTransitionId: ulid() },
						},
					]
				);

				expect(scheduledIds).toEqual([]);
				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
			}));
	}
});

describe("bulkTransitionToCancelled and bulkTransitionToCancelledInNamespace", () => {
	test("bulkTransitionToCancelledInNamespace cancels the namespace's runs and returns each run's revision, attempts, options and parent", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const pooledRun = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { pool: "warehouse-eu" } }
			);
			const parkedParentRun = await seedAwaitingChildRun({ namespaceRequestContext: context, repos, publisher });

			const cancelledRows = await repos.workflowRun.bulkTransitionToCancelledInNamespace(context.namespaceId, [
				pooledRun.runId,
				parkedParentRun.child.runId,
			]);

			expect([...cancelledRows].sort(orderById)).toEqual(
				[
					{
						id: pooledRun.runId,
						revision: pooledRun.revisionWhenClaimed + 1,
						attempts: pooledRun.attemptsWhenClaimed,
						options: { pool: "warehouse-eu" },
						parentWorkflowRunId: null,
					},
					{
						id: parkedParentRun.child.runId,
						revision: parkedParentRun.child.revisionWhenClaimed + 1,
						attempts: parkedParentRun.child.attemptsWhenClaimed,
						options: null,
						parentWorkflowRunId: parkedParentRun.runId,
					},
				].sort(orderById)
			);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: pooledRun.runId })).toEqual({
				id: pooledRun.runId,
				revision: pooledRun.revisionWhenClaimed + 1,
				status: "cancelled",
			});
			expect(
				await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: parkedParentRun.child.runId })
			).toEqual({
				id: parkedParentRun.child.runId,
				revision: parkedParentRun.child.revisionWhenClaimed + 1,
				status: "cancelled",
			});
		}));

	test("bulkTransitionToCancelledInNamespace leaves a run in another namespace alone", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const rowBefore = await getRunRow(repos, context.namespaceId, runId);
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;

			expect(await repos.workflowRun.bulkTransitionToCancelledInNamespace(otherNamespaceId, [runId])).toEqual([]);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
		}));

	test("bulkTransitionToCancelled cancels runs from any namespace and returns each run's namespace and revision", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const otherNamespaceContext = namespaceRequestContextFactory.build();
			const runInOwnNamespace = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const runInOtherNamespace = await seedClaimedRun({
				namespaceRequestContext: otherNamespaceContext,
				repos,
				publisher,
			});

			const cancelledRows = await repos.workflowRun.bulkTransitionToCancelled(daemonContextFactory.build(), [
				runInOwnNamespace.runId,
				runInOtherNamespace.runId,
			]);

			expect([...cancelledRows].sort(orderById)).toEqual(
				[
					{
						id: runInOwnNamespace.runId,
						namespaceId: context.namespaceId,
						revision: runInOwnNamespace.revisionWhenClaimed + 1,
						attempts: runInOwnNamespace.attemptsWhenClaimed,
						options: null,
						parentWorkflowRunId: null,
					},
					{
						id: runInOtherNamespace.runId,
						namespaceId: otherNamespaceContext.namespaceId,
						revision: runInOtherNamespace.revisionWhenClaimed + 1,
						attempts: runInOtherNamespace.attemptsWhenClaimed,
						options: null,
						parentWorkflowRunId: null,
					},
				].sort(orderById)
			);
			expect(
				await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runInOwnNamespace.runId })
			).toEqual({
				id: runInOwnNamespace.runId,
				revision: runInOwnNamespace.revisionWhenClaimed + 1,
				status: "cancelled",
			});
			expect(
				await repos.workflowRun.getById({
					namespaceId: otherNamespaceContext.namespaceId,
					id: runInOtherNamespace.runId,
				})
			).toEqual({
				id: runInOtherNamespace.runId,
				revision: runInOtherNamespace.revisionWhenClaimed + 1,
				status: "cancelled",
			});
		}));

	const terminalSeedByStatus = {
		cancelled: seedRunByStatus.cancelled,
		completed: seedRunByStatus.completed,
		failed: seedRunByStatus.failed,
	} satisfies Record<TerminalWorkflowRunStatus, RunSeed>;

	const cancelVariants = {
		bulkTransitionToCancelledInNamespace: (repos: Repositories, context: NamespaceRequestContext, runId: string) =>
			repos.workflowRun.bulkTransitionToCancelledInNamespace(context.namespaceId, [runId]),
		bulkTransitionToCancelled: (repos: Repositories, _context: NamespaceRequestContext, runId: string) =>
			repos.workflowRun.bulkTransitionToCancelled(daemonContextFactory.build(), [runId]),
	};

	for (const [variant, cancel] of Object.entries(cancelVariants)) {
		test(`${variant} clears the due time of the runs it cancels`, () =>
			withHarness(async ({ context, db, repos, publisher }) => {
				const { runId, wakeupAt } = await seedSleepingRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ sleepName: "cooldown", durationMs: 60_000 }
				);
				expect(await readWorkflowRunDueTimes(db, runId)).toEqual({ ...NO_DUE_TIMES, wakeupAt });

				await cancel(repos, context, runId);

				expect(await readWorkflowRunDueTimes(db, runId)).toEqual(NO_DUE_TIMES);
			}));

		for (const [status, seedRun] of Object.entries(terminalSeedByStatus)) {
			test(`${variant} leaves a ${status} run alone`, () =>
				withHarness(async ({ context, repos, publisher }) => {
					const { runId } = await seedRun({ repos, namespaceRequestContext: context, publisher });
					const rowBefore = await getRunRow(repos, context.namespaceId, runId);
					expect(rowBefore).toEqual(expect.objectContaining({ status }));

					expect(await cancel(repos, context, runId)).toEqual([]);
					expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
				}));
		}
	}
});

describe("bulkTransitionToStalled", () => {
	test("stalls queued runs and returns each run's namespace, revision and attempts", () =>
		withHarness(async ({ context, db, repos }) => {
			const { runId, revisionWhenQueued, attemptsWhenQueued } = await seedQueuedRun({
				repos,
				namespaceRequestContext: context,
			});

			expect(await repos.workflowRun.bulkTransitionToStalled(daemonContextFactory.build(), [runId])).toEqual([
				{ id: runId, namespaceId: context.namespaceId, revision: revisionWhenQueued + 1, attempts: attemptsWhenQueued },
			]);
			expect(await readWorkflowRunDueTimes(db, runId)).toEqual(NO_DUE_TIMES);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenQueued + 1,
				status: "stalled",
			});
		}));

	for (const [status, seedRun] of runSeedsForStatusesOtherThan("queued")) {
		test(`leaves a ${status} run alone`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ repos, namespaceRequestContext: context, publisher });
				const rowBefore = await getRunRow(repos, context.namespaceId, runId);
				expect(rowBefore).toEqual(expect.objectContaining({ status }));

				expect(await repos.workflowRun.bulkTransitionToStalled(daemonContextFactory.build(), [runId])).toEqual([]);
				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
			}));
	}
});

describe("bulkReleaseToQueued", () => {
	test("returns running runs to queued and returns each run's namespace, revision and attempts", () =>
		withHarness(async ({ context, db, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			expect(await repos.workflowRun.bulkReleaseToQueued(daemonContextFactory.build(), [runId])).toEqual([
				{
					id: runId,
					namespaceId: context.namespaceId,
					revision: revisionWhenClaimed + 1,
					attempts: attemptsWhenClaimed,
				},
			]);
			expect(await readWorkflowRunDueTimes(db, runId)).toEqual(NO_DUE_TIMES);
			expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual({
				id: runId,
				revision: revisionWhenClaimed + 1,
				status: "queued",
			});
		}));

	for (const [status, seedRun] of runSeedsForStatusesOtherThan("running")) {
		test(`leaves a ${status} run alone`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId } = await seedRun({ repos, namespaceRequestContext: context, publisher });
				const rowBefore = await getRunRow(repos, context.namespaceId, runId);
				expect(rowBefore).toEqual(expect.objectContaining({ status }));

				expect(await repos.workflowRun.bulkReleaseToQueued(daemonContextFactory.build(), [runId])).toEqual([]);
				expect(await repos.workflowRun.getById({ namespaceId: context.namespaceId, id: runId })).toEqual(rowBefore);
			}));
	}
});

describe("bulkSetLatestStateTransitionId", () => {
	test("points each given run at its transition and leaves the others", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const firstRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const secondRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const bystanderRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const bystanderBefore = await repos.workflowRun.getByIdWithState({
				namespaceId: context.namespaceId,
				id: bystanderRun.runId,
			});
			const firstTransitionId = ulid();
			const secondTransitionId = ulid();
			await repos.stateTransition.appendBatch([
				{
					id: firstTransitionId,
					workflowRunId: firstRun.runId,
					type: "workflow_run",
					attempt: firstRun.attemptsWhenClaimed,
					revision: firstRun.revisionWhenClaimed + 1,
					state: { status: "paused" },
				},
				{
					id: secondTransitionId,
					workflowRunId: secondRun.runId,
					type: "workflow_run",
					attempt: secondRun.attemptsWhenClaimed,
					revision: secondRun.revisionWhenClaimed + 1,
					state: { status: "paused" },
				},
			]);

			await repos.workflowRun.bulkSetLatestStateTransitionId([
				{
					filter: { namespaceId: context.namespaceId, id: firstRun.runId },
					update: { stateTransitionId: firstTransitionId },
				},
				{
					filter: { namespaceId: context.namespaceId, id: secondRun.runId },
					update: { stateTransitionId: secondTransitionId },
				},
			]);

			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: firstRun.runId })
			).toEqual({
				run: expect.objectContaining({ id: firstRun.runId, latestStateTransitionId: firstTransitionId }),
				state: { status: "paused" },
			});
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: secondRun.runId })
			).toEqual({
				run: expect.objectContaining({ id: secondRun.runId, latestStateTransitionId: secondTransitionId }),
				state: { status: "paused" },
			});
			expect(
				await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: bystanderRun.runId })
			).toEqual(bystanderBefore);
		}));
});
