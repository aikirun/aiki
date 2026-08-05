import { NotFoundError } from "@aikirun/lib/error";

import { describe, expect, test } from "bun:test";
import { processImminentScheduledRuns } from "../daemon/imminent-scheduled-runs";
import { InvalidWorkflowRunStateTransitionError, WorkflowRunRevisionConflictError } from "../errors";
import type { Repositories } from "../infra/db/types";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunStateMachineService } from "../service/workflow-run-state-machine";
import { daemonContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { seedClaimedRun, seedScheduledRun, seedStalledRun } from "../testing/run-seed";

const withHarness = createServiceHarness();

const daemonContext = daemonContextFactory.build();

function createStateMachine(repos: Repositories) {
	return createWorkflowRunStateMachineService({ repos, childRunCanceller: createChildRunCanceller() });
}

describe("WorkflowRunStateMachineService transition preconditions", () => {
	test("rejects a transition for an unknown run", () =>
		withHarness(async ({ context, repos }) => {
			const stateMachine = createStateMachine(repos);
			expect(
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
			expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "completed", output: { receipt: "r-1" } },
					// The pre-claim revision: exactly what a fenced-out worker would still hold.
					expectedRevision: revisionWhenClaimed - 1,
				})
			).rejects.toThrow(WorkflowRunRevisionConflictError);

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "running",
					revision: revisionWhenClaimed,
					attempts: attemptsWhenClaimed,
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
				state: { status: "completed", output: { receipt: "r-1" } },
				expectedRevision: revisionWhenClaimed,
			});

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "completed", output: { receipt: "r-1" } },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "completed",
					revision: result.revision,
					attempts: result.attempts,
					state: { status: "completed", output: { receipt: "r-1" } },
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

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "paused",
					revision: result.revision,
					attempts: result.attempts,
					state: { status: "paused" },
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
			expect(
				stateMachine.transitionState(context, {
					type: "optimistic",
					id: runId,
					state: { status: "stalled" },
					// The revision is correct: the transition itself is the only fault.
					expectedRevision: revisionWhenClaimed,
				})
			).rejects.toThrow(InvalidWorkflowRunStateTransitionError);

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "running",
					revision: revisionWhenClaimed,
					attempts: attemptsWhenClaimed,
				})
			);
		}));
});

describe("WorkflowRunStateMachineService attempt counting", () => {
	test("entering awaiting_retry charges no attempt", () =>
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
				state: {
					status: "awaiting_retry",
					cause: "self",
					error: { name: "Error", message: "boom" },
					nextAttemptInMs: 0,
				},
				expectedRevision: revisionWhenClaimed,
			});

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: {
					status: "awaiting_retry",
					cause: "self",
					error: { name: "Error", message: "boom" },
					nextAttemptAt: expect.any(Number),
				},
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "awaiting_retry",
					revision: result.revision,
					attempts: result.attempts,
				})
			);
		}));

	test("re-queueing a retry from awaiting_retry charges exactly one attempt", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const stateMachine = createStateMachine(repos);
			const awaitingRetryRun = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: {
					status: "awaiting_retry",
					cause: "self",
					error: { name: "Error", message: "boom" },
					nextAttemptInMs: 0,
				},
				expectedRevision: revisionWhenClaimed,
			});

			const result = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "queued", reason: "retry" },
				expectedRevision: awaitingRetryRun.revision,
			});

			expect(result).toEqual({
				revision: awaitingRetryRun.revision + 1,
				state: { status: "queued", reason: "retry" },
				attempts: attemptsWhenClaimed + 1,
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "queued",
					revision: result.revision,
					attempts: result.attempts,
					state: { status: "queued", reason: "retry" },
				})
			);
		}));

	test("a task_retry re-queue charges no attempt", () =>
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
				state: { status: "queued", reason: "task_retry" },
				expectedRevision: revisionWhenClaimed,
			});

			expect(result).toEqual({
				revision: revisionWhenClaimed + 1,
				state: { status: "queued", reason: "task_retry" },
				attempts: attemptsWhenClaimed,
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "queued",
					revision: result.revision,
					attempts: result.attempts,
					state: { status: "queued", reason: "task_retry" },
				})
			);
		}));

	test("a non-retry promotion from scheduled charges no attempt", () =>
		withHarness(async ({ context, repos }) => {
			const { runId, revisionWhenScheduled, attemptsWhenScheduled } = await seedScheduledRun({
				namespaceRequestContext: context,
				repos,
			});

			const stateMachine = createStateMachine(repos);
			const result = await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "queued", reason: "new" },
				expectedRevision: revisionWhenScheduled,
			});

			expect(result).toEqual({
				revision: revisionWhenScheduled + 1,
				state: { status: "queued", reason: "new" },
				attempts: attemptsWhenScheduled,
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "queued",
					revision: result.revision,
					attempts: result.attempts,
					state: { status: "queued", reason: "new" },
				})
			);
		}));
});

describe("WorkflowRunStateMachineService redelivery", () => {
	test("redelivers a stalled run to scheduled with reason redelivery", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
			});

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "scheduled",
					state: expect.objectContaining({ status: "scheduled", reason: "redelivery" }),
				})
			);
		}));

	test("promotes a redelivered run to queued with a fresh outbox row", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			expect(await repos.workflowRunOutbox.getByWorkflowRunId(context.namespaceId, runId)).toBeNull();

			const stateMachine = createStateMachine(repos);
			await stateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "scheduled", scheduledInMs: 0, reason: "redelivery" },
			});
			await processImminentScheduledRuns(
				daemonContext,
				{ repos },
				{ limit: 100, lookaheadWindowMs: 0, republishBackoff: { baseDelayMs: 5_000, maxDelayMs: 300_000 } }
			);

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "queued",
					state: { status: "queued", reason: "redelivery" },
				})
			);

			const row = await repos.workflowRunOutbox.getByWorkflowRunId(context.namespaceId, runId);
			expect(row).toEqual(expect.objectContaining({ workflowRunId: runId, status: "pending" }));
		}));

	test("does not allow scheduling a stalled run with a non-redelivery reason", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedStalledRun({ namespaceRequestContext: context, repos });

			const stateMachine = createStateMachine(repos);
			expect(
				stateMachine.transitionState(context, {
					type: "pessimistic",
					id: runId,
					state: { status: "scheduled", scheduledInMs: 0, reason: "resumption" },
				})
			).rejects.toThrow(InvalidWorkflowRunStateTransitionError);
		}));
});
