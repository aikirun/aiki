import type { WorkflowRunTransitionStateResponseV1 } from "@aikirun/types/api/workflow-run";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { TerminalWorkflowRunStatus } from "@aikirun/types/workflow/run";

import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createTaskStateMachineService } from "../service/task-state-machine";
import { createWorkflowRunService } from "../service/workflow-run";
import {
	createWorkflowRunStateMachineService,
	type WorkflowRunStateMachineService,
} from "../service/workflow-run-state-machine";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { seedClaimedRun } from "../testing/run-seed";

const withHarness = createServiceHarness();

function createService(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachineService = createWorkflowRunStateMachineService({ repos, childRunCanceller });
	return {
		service: createWorkflowRunService({ repos, childRunCanceller, workflowRunStateMachineService }),
		stateMachine: workflowRunStateMachineService,
	};
}

describe("WorkflowRunService getWorkflowRunById", () => {
	test("returns workflow run record content including source", () =>
		withHarness(async ({ context, repos }) => {
			const { service } = createService(repos);

			const runId = await service.createWorkflowRun(context, {
				name: "checkout",
				versionId: "v1",
				input: { orderId: "order-1" },
				options: { pool: "eu-west" },
			});

			const run = await service.getWorkflowRunById(context, runId);

			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					name: "checkout",
					versionId: "v1",
					source: "user",
					createdAt: expect.any(Number),
					revision: 0,
					stateTransitionId: expect.any(String),
					input: { orderId: "order-1" },
					inputHash: expect.any(String),
					options: { pool: "eu-west" },
					attempts: 1,
					tasks: {},
					sleeps: {},
					eventWaits: {},
					childWorkflowRuns: {},
					state: expect.objectContaining({
						status: "scheduled",
						reason: "new",
						scheduledAt: expect.any(Number),
					}),
				})
			);
		}));
});

describe("WorkflowRunService cancelByIds", () => {
	test("cancels a claimed run with reason Cancelled", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, attemptsWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const { service } = createService(repos);
			const result = await service.cancelByIds(context, { ids: [runId] });
			expect(result).toEqual({ cancelledIds: [runId] });

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "cancelled",
					revision: revisionWhenClaimed + 1,
					attempts: attemptsWhenClaimed,
					state: { status: "cancelled", reason: "Cancelled" },
				})
			);
		}));

	test("cancelling a claimed run deletes its outbox row", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toEqual(expect.objectContaining({ workflowRunId: runId }));

			const { service } = createService(repos);
			await service.cancelByIds(context, { ids: [runId] });

			expect(
				await repos.workflowRunOutbox.getByWorkflowRunId({ namespaceId: context.namespaceId, workflowRunId: runId })
			).toBeNull();
		}));

	test("an empty ids request cancels nothing", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const { service } = createService(repos);
			expect(await service.cancelByIds(context, { ids: [] })).toEqual({ cancelledIds: [] });

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(expect.objectContaining({ id: runId, status: "running", revision: revisionWhenClaimed }));
		}));

	test("cancelling a sleeping run cancels its active sleep", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const { service, stateMachine } = createService(repos);
			await stateMachine.transitionState(context, {
				type: "optimistic",
				id: runId,
				state: { status: "sleeping", sleepName: "nap", durationMs: 60_000 },
				expectedRevision: revisionWhenClaimed,
			});

			const cancelledAt = Date.now();
			const result = await withFakeClock(cancelledAt, () => service.cancelByIds(context, { ids: [runId] }));
			expect(result).toEqual({ cancelledIds: [runId] });

			const run = await repos.workflowRun.getByIdWithState(context.namespaceId, runId);
			expect(run).toEqual(
				expect.objectContaining({
					id: runId,
					status: "cancelled",
					state: { status: "cancelled", reason: "Cancelled" },
				})
			);

			const sleeps = await repos.sleep.listByWorkflowRunId(runId);
			expect(sleeps).toEqual([expect.objectContaining({ name: "nap", status: "cancelled", cancelledAt })]);
		}));

	Object.entries({
		cancelled: (context, stateMachine, seed) =>
			stateMachine.transitionState(context, {
				type: "pessimistic",
				id: seed.runId,
				state: { status: "cancelled" },
			}),
		completed: (context, stateMachine, seed) =>
			stateMachine.transitionState(context, {
				type: "optimistic",
				id: seed.runId,
				state: { status: "completed", output: "receipt-9" },
				expectedRevision: seed.revisionWhenClaimed,
			}),
		failed: (context, stateMachine, seed) =>
			stateMachine.transitionState(context, {
				type: "optimistic",
				id: seed.runId,
				state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
				expectedRevision: seed.revisionWhenClaimed,
			}),
	} satisfies Record<
		TerminalWorkflowRunStatus,
		(
			context: NamespaceRequestContext,
			stateMachine: WorkflowRunStateMachineService,
			seed: { runId: string; revisionWhenClaimed: number }
		) => Promise<WorkflowRunTransitionStateResponseV1>
	>).forEach(([status, reachTerminalStatus]) => {
		test(`does not cancel a ${status} run`, () =>
			withHarness(async ({ context, repos, publisher }) => {
				const terminalRunSeed = await seedClaimedRun({
					namespaceRequestContext: context,
					repos,
					publisher,
				});
				const { service, stateMachine } = createService(repos);
				const terminal = await reachTerminalStatus(context, stateMachine, terminalRunSeed);

				const { runId: cancellableRunId } = await seedClaimedRun({
					namespaceRequestContext: context,
					repos,
					publisher,
				});

				const result = await service.cancelByIds(context, { ids: [terminalRunSeed.runId, cancellableRunId] });
				expect(result).toEqual({ cancelledIds: [cancellableRunId] });

				const terminalRun = await repos.workflowRun.getByIdWithState(context.namespaceId, terminalRunSeed.runId);
				expect(terminalRun).toEqual(
					expect.objectContaining({
						id: terminalRunSeed.runId,
						status,
						revision: terminal.revision,
						state: terminal.state,
					})
				);
			}));
	});

	test("does not cancel a run from another namespace", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const otherNamespaceContext = namespaceRequestContextFactory.build({ namespaceId: "other-ns" as NamespaceId });
			const foreignRunSeed = await seedClaimedRun({
				namespaceRequestContext: otherNamespaceContext,
				repos,
				publisher,
			});

			const { service } = createService(repos);
			expect(await service.cancelByIds(context, { ids: [foreignRunSeed.runId] })).toEqual({ cancelledIds: [] });

			const foreignRun = await repos.workflowRun.getByIdWithState(
				otherNamespaceContext.namespaceId,
				foreignRunSeed.runId
			);
			expect(foreignRun).toEqual(
				expect.objectContaining({
					id: foreignRunSeed.runId,
					status: "running",
					revision: foreignRunSeed.revisionWhenClaimed,
				})
			);
		}));

	test("cancelling a run discards its running task", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachineService({ repos });
			const taskInfo = await taskStateMachine.transitionState(context, {
				type: "create",
				id: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				taskName: "charge-card",
				taskState: { status: "running", attempts: 1, input: { amountCents: 1250 } },
			});

			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["discarded"])).toBeEmpty();
			const runningTasks = await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["running"]);
			expect(runningTasks).toEqual([expect.objectContaining({ id: taskInfo.id, workflowRunId: runId })]);

			const { service } = createService(repos);
			await service.cancelByIds(context, { ids: [runId] });

			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["running"])).toBeEmpty();
			const discardedTasks = await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["discarded"]);
			expect(discardedTasks).toEqual([expect.objectContaining({ id: taskInfo.id, workflowRunId: runId })]);
		}));

	test("cancelling a parent with a live child schedules the cancel-child-runs workflow", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const parent = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });

			const { service } = createService(repos);
			const childRunId = await service.createWorkflowRun(context, {
				name: parent.workflowName,
				versionId: parent.workflowVersionId,
				input: { orderId: "order-9" },
				parentWorkflowRunId: parent.runId,
			});

			await service.cancelByIds(context, { ids: [parent.runId] });

			// The child is not cancelled inline: a system workflow run is scheduled to cascade the
			// cancellation, and the child stays untouched until that run executes.
			const scheduledRuns = await repos.workflowRun.listByFilters(
				context.namespaceId,
				{ status: ["scheduled"] },
				10,
				0,
				{
					order: "asc",
				}
			);
			expect(scheduledRuns).toEqual({
				rows: [
					expect.objectContaining({ id: childRunId, status: "scheduled", name: parent.workflowName }),
					expect.objectContaining({ status: "scheduled", name: "aiki:cancel-child-runs" }),
				],
				total: 2,
			});
		}));
});
