import { createBinaryLatch } from "@aikirun/lib/async";
import { asConfigProvider } from "@aikirun/lib/config";
import { NotFoundError } from "@aikirun/lib/error";
import { noopLogger } from "@aikirun/lib/logger";
import { inMemoryTimerPriorityQueue } from "@aikirun/memory";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { WorkflowRunStateRequest, WorkflowRunTransitionStateRequestV1 } from "@aikirun/types/api/workflow-run";
import type { TerminalWorkflowRunStatus, WorkflowRunId } from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { createWorkflowRunStateMachine } from "./workflow-run";
import { processImminentScheduledRuns } from "../../daemon/imminent-scheduled-runs";
import { processImminentSleepElapsedRuns } from "../../daemon/imminent-sleep-elapsed-runs";
import { InvalidWorkflowRunStateTransitionError, WorkflowRunRevisionConflictError } from "../../errors";
import type { Repositories, TxRepositories } from "../../infra/db/types";
import { createImminentTimerQueue, type ImminentTimerQueue } from "../../infra/timer/imminent-timer-queue";
import { computeRank } from "../../lib/rank";
import { withFakeClock } from "../../testing/clock";
import { daemonContextFactory } from "../../testing/data-factory/middleware/context";
import { createServiceHarness, type ServiceHarnessDeps, withRepos } from "../../testing/harness";
import { allowsConcurrentWriteTransactions } from "../../testing/infra/db/transaction";
import {
	claimRun,
	seedClaimedRun,
	seedCompletedRun,
	seedPublishedRun,
	seedQueuedRun,
	seedScheduledRun,
	seedStalledRun,
} from "../../testing/seed/run";
import { seedAwaitingRetryTask, seedRunningTask, seedSiblingAwaitingRetryTasks } from "../../testing/seed/task";
import { createChildRunCanceller } from "../cancel-child-runs";
import { createEventService } from "../event";

const withHarness = createServiceHarness();

const daemonContext = daemonContextFactory.build();

function createStateMachine(repos: Repositories, imminentTimerQueue?: ImminentTimerQueue) {
	return createWorkflowRunStateMachine({ repos, childRunCanceller: createChildRunCanceller(), imminentTimerQueue });
}

describe("WorkflowRunStateMachine transition preconditions", () => {
	test("rejects a transition for an unknown run", () =>
		withHarness(async ({ context, repos }) => {
			const stateMachine = createStateMachine(repos);
			await expect(
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: "run-missing",
					state: { status: "cancelled" },
				})
			).rejects.toThrow(NotFoundError);
		}));

	test("a stale expectedRevision is rejected without touching the run", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
					// The pre-claim revision: exactly what a fenced-out worker would still hold.
					expectedRevision: revisionWhenClaimed - 1,
				})
			).rejects.toThrow(WorkflowRunRevisionConflictError);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "running",
						revision: revisionWhenClaimed,
						attempts: attemptsWhenClaimed,
					}),
				})
			);
		}));

	test("an optimistic transition with the current revision returns the new revision, state, and attempts matching the persisted run", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const result = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
				expectedRevision: revisionWhenClaimed,
			});

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "completed",
						revision: result.revision,
						attempts: result.attempts,
					}),
					state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
				})
			);
		}));

	test("a pessimistic transition succeeds without a revision", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const result = await stateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "paused" },
			});

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "paused" },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "paused",
						revision: result.revision,
						attempts: result.attempts,
					}),
					state: { status: "paused" },
				})
			);
		}));

	test("a stale expectedRevision is a revision conflict even when the move is illegal from the current state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedCompletedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			// A worker that fetched the run before another worker finished it still holds the
			// pre-completion revision and asks for 'running'. It is told the run moved, not that
			// the move is illegal, so it settles the delivery instead of reporting an error.
			await expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "running" },
					expectedRevision: revisionWhenClaimed,
				})
			).rejects.toThrow(WorkflowRunRevisionConflictError);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			// Completion moved the revision one past the claim.
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, revision: revisionWhenClaimed + 1 }),
					state: expect.objectContaining({ status: "completed" }),
				})
			);
		}));

	test("an invalid transition is rejected without touching the run", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					// Only a run waiting for an event is scheduled by one.
					state: { status: "scheduled", reason: "event", scheduledInMs: 0 },
					// The revision is correct: the transition itself is the only fault.
					expectedRevision: revisionWhenClaimed,
				})
			).rejects.toThrow(InvalidWorkflowRunStateTransitionError);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "running",
						revision: revisionWhenClaimed,
						attempts: attemptsWhenClaimed,
					}),
				})
			);
		}));
});

describe("WorkflowRunStateMachine attempt counting", () => {
	test("entering awaiting_retry charges no attempt", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const failedAt = Date.now();
			const result = await withFakeClock(failedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: {
						status: "awaiting_retry",
						cause: "self",
						error: { name: "Error", message: "boom" },
						nextAttemptInMs: 10_000,
					},
					expectedRevision: revisionWhenClaimed,
				})
			);

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: {
					status: "awaiting_retry",
					cause: "self",
					error: { name: "Error", message: "boom" },
					nextAttemptAt: failedAt + 10_000,
				},
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "awaiting_retry",
						revision: result.revision,
						attempts: result.attempts,
					}),
				})
			);
		}));
});

describe("WorkflowRunStateMachine task-retry suspension", () => {
	test("suspending a run for its retrying tasks stores the earliest task deadline", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedSiblingAwaitingRetryTasks(
				{ namespaceRequestContext: context, repos, publisher },
				{ firstNextAttemptAt: 1, siblingNextAttemptAt: 2 }
			);
			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toEqual(expect.objectContaining({ workflowRunId: runId, status: "claimed" }));

			const stateMachine = createStateMachine(repos);
			const suspendedRun = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "awaiting_task_retry" },
				expectedRevision: revisionWhenClaimed,
			});

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toBeNull();

			expect(suspendedRun).toEqual({
				revision: revisionWhenClaimed + 1,
				attempts: attemptsWhenClaimed,
				state: { status: "awaiting_task_retry", nextAttemptAt: 1 },
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "awaiting_task_retry" }),
					state: { status: "awaiting_task_retry", nextAttemptAt: 1 },
				})
			);
		}));

	test("a suspension with no task awaiting a retry is rejected", () =>
		withHarness(async ({ context, repos, publisher }) => {
			// The seeded task is running, not awaiting a retry — there is no deadline to suspend on.
			const { runId, revisionWhenClaimed } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "awaiting_task_retry" },
					expectedRevision: revisionWhenClaimed,
				})
			).rejects.toBeInstanceOf(InvalidWorkflowRunStateTransitionError);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: runId, status: "running", revision: revisionWhenClaimed }),
				})
			);
		}));
});

describe("WorkflowRunStateMachine sleep lifecycle", () => {
	test("entering sleeping state creates an active sleep row", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const sleepStartedAt = Date.now();
			const result = await withFakeClock(sleepStartedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
					expectedRevision: revisionWhenClaimed,
				})
			);

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "sleeping", sleepName: "nap", wakeupAt: sleepStartedAt + 60_000 },
				attempts: attemptsWhenClaimed,
			});

			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([expect.objectContaining({ workflowRunId: runId, name: "nap", status: "sleeping" })]);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "sleeping",
						revision: result.revision,
						attempts: result.attempts,
					}),
					state: { status: "sleeping", sleepName: "nap", wakeupAt: sleepStartedAt + 60_000 },
				})
			);
		}));

	test("an early wakeup cancels the active sleep", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const sleeping = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
				expectedRevision: revisionWhenClaimed,
			});

			const earlyWakeupAt = Date.now();
			const result = await withFakeClock(earlyWakeupAt, () =>
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" },
				})
			);

			expect(result).toEqual({
				revision: sleeping.revision + 1,
				state: { status: "scheduled", reason: "wakeup_early", scheduledAt: earlyWakeupAt },
				attempts: sleeping.attempts,
			});

			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([
				expect.objectContaining({ name: "nap", status: "cancelled", cancelledAt: earlyWakeupAt }),
			]);
		}));

	test("an early wakeup cancels only the active sleep, not prior finalized sleeps", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 0 },
				expectedRevision: revisionWhenClaimed,
			});

			const firstSleepCompletedAt = Date.now();
			await withFakeClock(firstSleepCompletedAt, () =>
				processImminentSleepElapsedRuns(
					daemonContext,
					{ repos },
					{
						pageSize: 100,
						lookaheadWindowMs: 0,
						overshootMs: 0,
						republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
						chunk: { size: 100, maxConcurrency: 10 },
					}
				)
			);
			const reclaimed = await claimRun({ context, repos, runId });
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
				expectedRevision: reclaimed.revisionWhenClaimed,
			});

			const secondEarlyWakeupAt = Date.now();
			await withFakeClock(secondEarlyWakeupAt, () =>
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "wakeup_early" },
				})
			);

			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([
				expect.objectContaining({
					name: "nap",
					status: "completed",
					completedAt: firstSleepCompletedAt,
					cancelledAt: null,
				}),
				expect.objectContaining({
					name: "nap",
					status: "cancelled",
					completedAt: null,
					cancelledAt: secondEarlyWakeupAt,
				}),
			]);
		}));

	test("cancelling a sleeping run cancels its active sleep", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
				expectedRevision: revisionWhenClaimed,
			});

			const cancelledAt = Date.now();
			await withFakeClock(cancelledAt, () =>
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "cancelled" },
				})
			);

			// The sleep daemon finds due sleeps by scanning runs with status sleeping. A cancelled run
			// leaves that scan, so nothing ever revisits its sleep row: the cancel must finalize the
			// sleep here, or the row stays active forever.
			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([expect.objectContaining({ name: "nap", status: "cancelled", cancelledAt: cancelledAt })]);
		}));
});

describe("WorkflowRunStateMachine redelivery", () => {
	test("redelivers a stalled run to scheduled with reason redelivery", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "scheduled",
					}),
					state: expect.objectContaining({ status: "scheduled", reason: "redelivery" }),
				})
			);
		}));

	test("promotes a redelivered run to queued with a fresh outbox row", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toBeNull();

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
			});
			await processImminentScheduledRuns(
				daemonContext,
				{ repos },
				{
					pageSize: 100,
					lookaheadWindowMs: 0,
					overshootMs: 0,
					republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000, declinedBackoffMs: 30_000 },
					chunk: { size: 100, maxConcurrency: 10 },
				}
			);

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "queued",
					}),
					state: { status: "queued", reason: "redelivery" },
				})
			);

			const row = await repos.workflowRunOutbox.getByWorkflowRunId({
				namespaceId: context.namespaceId,
				workflowRunId: runId,
			});
			expect(row).toEqual(expect.objectContaining({ workflowRunId: runId, status: "pending" }));
		}));

	test("does not allow scheduling a stalled run with a non-redelivery reason", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			const stateMachine = createStateMachine(repos);
			await expect(
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "resumption" },
				})
			).rejects.toThrow(InvalidWorkflowRunStateTransitionError);
		}));
});

describe("WorkflowRunStateMachine signal sequence guarded suspension", () => {
	test.skipIf(!allowsConcurrentWriteTransactions())(
		"an event committing between the suspension's read and its guarded write reschedules instead of suspending",
		() =>
			withHarness(async ({ context, repos, publisher }) =>
				withRepos(async (secondaryRepos) => {
					const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
						namespaceRequestContext: context,
						repos,
						publisher,
					});

					const suspensionReachedGuardedWrite = createBinaryLatch();
					const eventCommitted = createBinaryLatch();

					const stateMachine = createStateMachine(repos);
					const suspendedAt = Date.now();
					const result = await withFakeClock(suspendedAt, async () => {
						// The suspension pauses at its guarded write, after its read and revision precheck
						// have passed — the window the send lands in.
						const suspensionPromise = repos.transaction(async (txRepos) => {
							const pausingTxRepos: TxRepositories = {
								...txRepos,
								workflowRun: {
									...txRepos.workflowRun,
									update: async (params) => {
										suspensionReachedGuardedWrite.signal();
										await eventCommitted.wait();
										return txRepos.workflowRun.update(params);
									},
								},
							};

							return stateMachine.transitionState(
								context,
								{
									type: "optimistic",
									id: runId,
									state: { status: "awaiting_event", eventName: "paymentReceived" },
									expectedRevision: revisionWhenClaimed,
									expectedSignalSequence: 0,
								},
								pausingTxRepos
							);
						});
						await suspensionReachedGuardedWrite.wait();

						await createEventService({
							repos: secondaryRepos,
							workflowRunStateMachine: createStateMachine(secondaryRepos),
						}).sendEventToWorkflowRun(context, {
							runId: runId as WorkflowRunId,
							eventName: "paymentReceived",
							data: asOpaquePayload({ amount: 25 }),
							clientCodecApplied: false,
							reference: undefined,
						});
						eventCommitted.signal();

						return suspensionPromise;
					});

					expect(result).toEqual({
						revision: revisionWhenClaimed + 1,
						state: { status: "scheduled", reason: "event", scheduledAt: suspendedAt },
						attempts: attemptsWhenClaimed,
					});

					const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
					expect(run).toEqual(
						expect.objectContaining({
							run: expect.objectContaining({ id: runId, status: "scheduled", revision: result.revision }),
							state: { status: "scheduled", reason: "event", scheduledAt: suspendedAt },
						})
					);
					expect(await repos.eventWait.listByWorkflowRunId(runId)).toEqual([
						expect.objectContaining({ workflowRunId: runId, name: "paymentReceived", status: "received" }),
					]);
				})
			)
	);

	test("a suspension with the run's current signal sequence suspends it", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const suspendedAt = Date.now();
			const result = await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "awaiting_event", eventName: "paymentReceived", timeoutInMs: 60_000 },
					expectedRevision: revisionWhenClaimed,
					expectedSignalSequence: 0,
				})
			);

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "awaiting_event", eventName: "paymentReceived", timeoutAt: suspendedAt + 60_000 },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "awaiting_event",
						revision: result.revision,
						attempts: result.attempts,
					}),
					state: { status: "awaiting_event", eventName: "paymentReceived", timeoutAt: suspendedAt + 60_000 },
				})
			);
		}));

	test("an event landing between the worker's read and its suspension reschedules the run instead of suspending it", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			await createEventService({ repos, workflowRunStateMachine: stateMachine }).sendEventToWorkflowRun(context, {
				runId: runId as WorkflowRunId,
				eventName: "paymentReceived",
				data: asOpaquePayload({ amount: 25 }),
				clientCodecApplied: false,
				reference: undefined,
			});

			const suspendedAt = Date.now();
			const result = await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "awaiting_event", eventName: "paymentReceived" },
					expectedRevision: revisionWhenClaimed,
					// The sequence the worker read before the event landed.
					expectedSignalSequence: 0,
				})
			);

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "scheduled", reason: "event", scheduledAt: suspendedAt },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({
						id: runId,
						status: "scheduled",
						revision: result.revision,
						attempts: result.attempts,
					}),
					state: { status: "scheduled", reason: "event", scheduledAt: suspendedAt },
				})
			);
		}));

	test("a signal landing before a child-workflow suspension reschedules the run with reason child_workflow", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			// Still scheduled, so the parent's wait is genuinely needed.
			const child = await seedScheduledRun({ namespaceRequestContext: context, repos });

			const stateMachine = createStateMachine(repos);
			// One sequence counts every signal: an event moves it even for a child-workflow suspension.
			await createEventService({ repos, workflowRunStateMachine: stateMachine }).sendEventToWorkflowRun(context, {
				runId: parent.runId as WorkflowRunId,
				eventName: "paymentReceived",
				data: asOpaquePayload({ amount: 25 }),
				clientCodecApplied: false,
				reference: undefined,
			});

			const suspendedAt = Date.now();
			const result = await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: parent.runId,
					state: {
						status: "awaiting_child_workflow",
						childWorkflowRunId: child.runId,
					},
					expectedRevision: parent.revisionWhenClaimed,
					expectedSignalSequence: 0,
				})
			);

			expect(result).toEqual({
				revision: parent.revisionWhenClaimed + 1,
				state: { status: "scheduled", reason: "child_workflow", scheduledAt: suspendedAt },
				attempts: parent.attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState({ namespaceId: context.namespaceId, id: parent.runId });
			expect(run).toEqual(
				expect.objectContaining({
					run: expect.objectContaining({ id: parent.runId, status: "scheduled", revision: result.revision }),
					state: { status: "scheduled", reason: "child_workflow", scheduledAt: suspendedAt },
				})
			);
		}));

	test("a mismatched suspension adds the run's timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);
			await createEventService({ repos, workflowRunStateMachine: stateMachine }).sendEventToWorkflowRun(context, {
				runId: runId as WorkflowRunId,
				eventName: "paymentReceived",
				data: asOpaquePayload({ amount: 25 }),
				clientCodecApplied: false,
				reference: undefined,
			});

			const suspendedAt = Date.now();
			await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "awaiting_event", eventName: "paymentReceived" },
					expectedRevision: revisionWhenClaimed,
					expectedSignalSequence: 0,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "scheduled", id: runId, rank: computeRank({ dueAt: suspendedAt }) },
			]);
		}));

	test("a suspension on an already terminal child schedules the run immediately", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const child = await seedCompletedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
			);

			const stateMachine = createStateMachine(repos);
			const suspendedAt = Date.now();
			const result = await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: parent.runId,
					state: {
						status: "awaiting_child_workflow",
						childWorkflowRunId: child.runId,
					},
					expectedRevision: parent.revisionWhenClaimed,
					// The sequence the parent's worker read before the child finished.
					expectedSignalSequence: 0,
				})
			);

			expect(result).toEqual({
				revision: parent.revisionWhenClaimed + 1,
				state: { status: "scheduled", reason: "child_workflow", scheduledAt: suspendedAt },
				attempts: parent.attemptsWhenClaimed,
			});
		}));
});

describe("WorkflowRunStateMachine child terminal signals", () => {
	const terminalTransitionByStatus = {
		completed: {
			request: (id: string, expectedRevision: number) =>
				({
					type: "optimistic",
					id,
					state: { status: "completed", output: asOpaquePayload({ receiptId: "child-receipt-9" }) },
					expectedRevision,
				}) as const,
			expectedChildState: { status: "completed", output: asOpaquePayload({ receiptId: "child-receipt-9" }) },
		},
		failed: {
			request: (id: string, expectedRevision: number) =>
				({
					type: "optimistic",
					id,
					state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
					expectedRevision,
				}) as const,
			expectedChildState: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
		},
		cancelled: {
			request: (id: string) => ({ type: "pessimistic", id, state: { status: "cancelled" } }) as const,
			expectedChildState: { status: "cancelled" },
		},
	} satisfies Record<
		TerminalWorkflowRunStatus,
		{
			request: (id: string, expectedRevision: number) => WorkflowRunTransitionStateRequestV1;
			expectedChildState: unknown;
		}
	>;

	for (const [status, { request, expectedChildState }] of Object.entries(terminalTransitionByStatus)) {
		test(`a child reaching ${status} writes the wait row`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
				const child = await seedClaimedRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
				);

				const stateMachine = createStateMachine(repos);
				await stateMachine.transitionState(context, request(child.runId, child.revisionWhenClaimed));

				expect(await repos.childWorkflowRunWait.listByParentRunIdWithChildState(parent.runId)).toEqual([
					expect.objectContaining({
						parentWorkflowRunId: parent.runId,
						childWorkflowRunId: child.runId,
						childWorkflowRunStatus: status,
						status: "completed",
						childWorkflowRunState: expectedChildState,
						signalSequence: 1,
					}),
				]);
			}));

		test(`a child reaching ${status} bumps its parent's signal sequence`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
				const child = await seedClaimedRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
				);

				const stateMachine = createStateMachine(repos);
				await stateMachine.transitionState(context, request(child.runId, child.revisionWhenClaimed));

				const parentRecord = await repos.workflowRun.getByIdWithState({
					namespaceId: context.namespaceId,
					id: parent.runId,
				});
				expect(parentRecord).toEqual(
					expect.objectContaining({
						run: expect.objectContaining({
							id: parent.runId,
							revision: parent.revisionWhenClaimed,
							signalSequence: 1,
						}),
						state: { status: "running" },
					})
				);
			}));

		test(`a child reaching ${status} wakes a parent waiting on it and adds its timer to the priority queue`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
				const child = await seedClaimedRun(
					{ namespaceRequestContext: context, repos, publisher },
					{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
				);

				const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
				const stateMachine = createStateMachine(
					repos,
					createImminentTimerQueue({
						timerPriorityQueue,
						configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
						logger: noopLogger,
					})
				);
				const suspendedParent = await stateMachine.transitionState(context, {
					type: "optimistic",
					id: parent.runId,
					state: {
						status: "awaiting_child_workflow",
						childWorkflowRunId: child.runId,
					},
					expectedRevision: parent.revisionWhenClaimed,
					expectedSignalSequence: 0,
				});

				const childTerminatedAt = Date.now();
				await withFakeClock(childTerminatedAt, () =>
					stateMachine.transitionState(context, request(child.runId, child.revisionWhenClaimed))
				);

				const parentRun = await repos.workflowRun.getByIdWithState({
					namespaceId: context.namespaceId,
					id: parent.runId,
				});
				expect(parentRun).toEqual(
					expect.objectContaining({
						run: expect.objectContaining({
							id: parent.runId,
							status: "scheduled",
							revision: suspendedParent.revision + 1,
						}),
						state: { status: "scheduled", reason: "child_workflow", scheduledAt: childTerminatedAt },
					})
				);
				expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
					{ type: "scheduled", id: parent.runId, rank: computeRank({ dueAt: childTerminatedAt }) },
				]);
			}));
	}
});

describe("WorkflowRunStateMachine imminent run timers", () => {
	test("a transition into scheduled adds the run's timer to the priority queue", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const redeliveredAtMs = Date.now();
			await withFakeClock(redeliveredAtMs, () =>
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "scheduled", id: runId, rank: computeRank({ dueAt: redeliveredAtMs }) },
			]);
		}));

	test("a scheduled transition mints the run's timer with its priority", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos }, { options: { priority: 2 } });

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const redeliveredAtMs = Date.now();
			await withFakeClock(redeliveredAtMs, () =>
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "scheduled", id: runId, rank: computeRank({ dueAt: redeliveredAtMs, priority: 2 }) },
			]);
		}));

	test("a parent's wakeup timer carries the parent's priority", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parent = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ options: { priority: 2 } }
			);
			const child = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: parent.runId,
				state: { status: "awaiting_child_workflow", childWorkflowRunId: child.runId },
				expectedRevision: parent.revisionWhenClaimed,
				expectedSignalSequence: 0,
			});

			const childTerminatedAt = Date.now();
			await withFakeClock(childTerminatedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: child.runId,
					state: { status: "completed", output: asOpaquePayload({ receiptId: "rcp-7" }) },
					expectedRevision: child.revisionWhenClaimed,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "scheduled", id: parent.runId, rank: computeRank({ dueAt: childTerminatedAt, priority: 2 }) },
			]);
		}));

	test("a transition into sleeping adds the run's wakeup timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const sleepStartedAt = Date.now();
			await withFakeClock(sleepStartedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "sleeping", sleepName: "restock-window", durationMs: 5_000 },
					expectedRevision: revisionWhenClaimed,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "sleep", id: runId, rank: computeRank({ dueAt: sleepStartedAt + 5_000 }) },
			]);
		}));

	test("a suspension on an event with a timeout adds the run's timeout timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const suspendedAt = Date.now();
			await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "awaiting_event", eventName: "paymentReceived", timeoutInMs: 5_000 },
					expectedRevision: revisionWhenClaimed,
					expectedSignalSequence: 0,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "event_wait_timeout", id: runId, rank: computeRank({ dueAt: suspendedAt + 5_000 }) },
			]);
		}));

	test("a suspension on an event with no timeout adds no timer", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "awaiting_event", eventName: "paymentReceived" },
				expectedRevision: revisionWhenClaimed,
				expectedSignalSequence: 0,
			});

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([]);
		}));

	test("a suspension on a child with a timeout adds the run's timeout timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const child = await seedClaimedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ parent: { workflowRunId: parent.runId, expectedRevision: parent.revisionWhenClaimed } }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const suspendedAt = Date.now();
			await withFakeClock(suspendedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: parent.runId,
					state: { status: "awaiting_child_workflow", childWorkflowRunId: child.runId, timeoutInMs: 5_000 },
					expectedRevision: parent.revisionWhenClaimed,
					expectedSignalSequence: 0,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "child_wait_timeout", id: parent.runId, rank: computeRank({ dueAt: suspendedAt + 5_000 }) },
			]);
		}));

	test("a transition into awaiting_retry adds the run's retry timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			const failedAt = Date.now();
			await withFakeClock(failedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: {
						status: "awaiting_retry",
						cause: "self",
						error: { name: "Error", message: "boom" },
						nextAttemptInMs: 5_000,
					},
					expectedRevision: revisionWhenClaimed,
				})
			);

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "retry", id: runId, rank: computeRank({ dueAt: failedAt + 5_000 }) },
			]);
		}));

	test("a suspension on a retrying task adds the run's task retry timer to the priority queue", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedAwaitingRetryTask(
				{ namespaceRequestContext: context, repos, publisher },
				{ nextAttemptAt: 1 }
			);

			const timerPriorityQueue = inMemoryTimerPriorityQueue()({ logger: noopLogger });
			const stateMachine = createStateMachine(
				repos,
				createImminentTimerQueue({
					timerPriorityQueue,
					configProvider: asConfigProvider(() => ({ lookaheadWindowMs: 30_000, overshootMs: 0 })),
					logger: noopLogger,
				})
			);

			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "awaiting_task_retry" },
				expectedRevision: revisionWhenClaimed,
			});

			expect(await timerPriorityQueue.popDue({ maxRank: Number.MAX_SAFE_INTEGER, limit: 10 })).toEqual([
				{ type: "task_retry", id: runId, rank: computeRank({ dueAt: 1 }) },
			]);
		}));
});

describe("WorkflowRunStateMachine outbox row", () => {
	test("claiming a queued run marks its outbox row claimed at the claim time", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenQueued, outboxRowId } = await seedPublishedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const claimedAt = Date.now();
			await withFakeClock(claimedAt, () =>
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "running" },
					expectedRevision: revisionWhenQueued,
				})
			);

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toEqual(expect.objectContaining({ id: outboxRowId, workflowRunId: runId, status: "claimed", claimedAt }));
		}));

	type SeedRunWithOutboxRow = (
		deps: Pick<ServiceHarnessDeps, "context" | "repos" | "publisher">
	) => Promise<{ runId: string; transitionRun: () => Promise<unknown> }>;

	// A run reaches `scheduled` only from a status that has no outbox row, so no test can show the
	// row being deleted. A move to `running` keeps the row: the test above covers it.
	const seedRunWithOutboxRowByDestination = {
		paused: async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "pessimistic",
						id: runId,
						state: { status: "paused" },
					}),
			};
		},
		sleeping: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: { status: "sleeping", sleepName: "cool-down", durationMs: 60_000 },
						expectedRevision: revisionWhenClaimed,
					}),
			};
		},
		awaiting_event: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: { status: "awaiting_event", eventName: "paymentReceived" },
						expectedRevision: revisionWhenClaimed,
						expectedSignalSequence: 0,
					}),
			};
		},
		awaiting_retry: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: {
							status: "awaiting_retry",
							cause: "self",
							error: { name: "Error", message: "inventory service unavailable" },
							nextAttemptInMs: 60_000,
						},
						expectedRevision: revisionWhenClaimed,
					}),
			};
		},
		awaiting_task_retry: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedAwaitingRetryTask(
				{ namespaceRequestContext: context, repos, publisher },
				{ nextAttemptAt: 1 }
			);
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: { status: "awaiting_task_retry" },
						expectedRevision: revisionWhenClaimed,
					}),
			};
		},
		awaiting_child_workflow: async ({ context, repos, publisher }) => {
			const parentRun = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const childRun = await seedScheduledRun(
				{ namespaceRequestContext: context, repos },
				{ parent: { workflowRunId: parentRun.runId, expectedRevision: parentRun.revisionWhenClaimed } }
			);
			return {
				runId: parentRun.runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: parentRun.runId,
						state: { status: "awaiting_child_workflow", childWorkflowRunId: childRun.runId },
						expectedRevision: parentRun.revisionWhenClaimed,
						expectedSignalSequence: 0,
					}),
			};
		},
		cancelled: async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "pessimistic",
						id: runId,
						state: { status: "cancelled" },
					}),
			};
		},
		completed: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: { status: "completed", output: asOpaquePayload({ receipt: "r-1" }) },
						expectedRevision: revisionWhenClaimed,
					}),
			};
		},
		failed: async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "optimistic",
						id: runId,
						state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
						expectedRevision: revisionWhenClaimed,
					}),
			};
		},
		stalled: async ({ context, repos }) => {
			const { runId } = await seedQueuedRun({ namespaceRequestContext: context, repos });
			return {
				runId,
				transitionRun: () =>
					createStateMachine(repos).transitionState(context, {
						type: "pessimistic",
						id: runId,
						state: { status: "stalled" },
					}),
			};
		},
	} satisfies { [Status in Exclude<WorkflowRunStateRequest["status"], "running" | "scheduled">]: SeedRunWithOutboxRow };

	for (const [destination, seedRun] of Object.entries(seedRunWithOutboxRowByDestination)) {
		test(`moving a run to ${destination} deletes its outbox row`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const { runId, transitionRun } = await seedRun({ context, repos, publisher });
				expect(
					await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
				).toEqual(expect.objectContaining({ workflowRunId: runId }));

				await transitionRun();

				expect(
					await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
				).toBeNull();
			}));
	}
});
