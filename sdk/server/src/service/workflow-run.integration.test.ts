import { hashInput } from "@aikirun/lib/crypto";
import type { WorkflowRunTransitionStateResponseV1 } from "@aikirun/types/api/workflow-run";
import type { NamespaceId } from "@aikirun/types/namespace";
import type { TerminalWorkflowRunStatus } from "@aikirun/types/workflow/run";

import { createTaskStateMachine } from "./state-machine/task";
import { createWorkflowRunStateMachine, type WorkflowRunStateMachine } from "./state-machine/workflow-run";
import { describe, expect, test } from "bun:test";
import type { Repositories } from "../infra/db/types";
import type { NamespaceRequestContext } from "../middleware/context";
import { createChildRunCanceller } from "../service/cancel-child-runs";
import { createWorkflowRunService } from "../service/workflow-run";
import { withFakeClock } from "../testing/clock";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { seedClaimedRun } from "../testing/seed/run";
import { seedRunningTask } from "../testing/seed/task";

const withHarness = createServiceHarness();

function createService(repos: Repositories) {
	const childRunCanceller = createChildRunCanceller();
	const workflowRunStateMachine = createWorkflowRunStateMachine({ repos, childRunCanceller });
	return {
		service: createWorkflowRunService({ repos, childRunCanceller, workflowRunStateMachine }),
		stateMachine: workflowRunStateMachine,
	};
}

describe("WorkflowRunService getWorkflowRunById", () => {
	test("returns workflow run record content including source", () =>
		withHarness(async ({ context, repos }) => {
			const { service } = createService(repos);

			const input = { orderId: "order-1" };
			const inputHash = await hashInput(input);
			const runId = await service.createWorkflowRun(context, {
				name: "checkout",
				versionId: "v1",
				input,
				inputHash,
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
					inputHash,
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

	test("returns the run's tasks", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const { service } = createService(repos);
			const run = await service.getWorkflowRunById(context, runId);
			expect(Object.values(run.tasks)).toEqual([
				[
					{
						id: taskInfo.id,
						name: taskInfo.name,
						state: { status: "running", attempts: 1 },
						inputHash: taskInfo.inputHash,
					},
				],
			]);
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
			stateMachine: WorkflowRunStateMachine,
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

			const taskStateMachine = createTaskStateMachine({ repos });
			const taskInput = { amountCents: 1250 };
			const taskInfo = await taskStateMachine.transitionState(context, {
				type: "create",
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				taskName: "charge-card",
				input: taskInput,
				inputHash: await hashInput(taskInput),
				taskState: { status: "running" },
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
			const childInput = { orderId: "order-9" };
			const childRunId = await service.createWorkflowRun(context, {
				name: parent.workflowName,
				versionId: parent.workflowVersionId,
				input: childInput,
				inputHash: await hashInput(childInput),
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
					expect.objectContaining({ status: "scheduled", name: "cancel-child-runs" }),
				],
				total: 2,
			});
		}));
});

describe("WorkflowRunService listWorkflowRunTransitions", () => {
	test("lists a task's transitions with their stored states", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachine({ repos });
			await taskStateMachine.transitionState(context, {
				type: "retry",
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				id: taskInfo.id,
				taskState: { status: "running", attempts: 2 },
			});

			const { service } = createService(repos);
			const { transitions } = await service.listWorkflowRunTransitions(context, {
				id: runId,
				sort: { order: "asc" },
			});
			const taskTransitions = transitions.filter((transition) => transition.type === "task");
			expect(taskTransitions).toEqual([
				{
					id: expect.any(String),
					createdAt: expect.any(Number),
					type: "task",
					attempt: 1,
					taskId: taskInfo.id,
					taskState: { status: "running", attempts: 1 },
				},
				{
					id: expect.any(String),
					createdAt: expect.any(Number),
					type: "task",
					attempt: 2,
					taskId: taskInfo.id,
					taskState: { status: "running", attempts: 2 },
				},
			]);
		}));
});
