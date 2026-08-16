import { describe, expect, test } from "bun:test";
import { createTaskStateMachine } from "../../service/state-machine/task";
import { createServiceHarness } from "../../testing/harness";
import { seedCompletedTask, seedRunningTask } from "../../testing/seed/task";

const withHarness = createServiceHarness();

describe("task repository state reads", () => {
	test("getByIdWithState returns a completed state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { taskInfo } = await seedCompletedTask(
				{
					namespaceRequestContext: context,
					repos,
					publisher,
				},
				{ output: undefined }
			);

			const row = await repos.task.getByIdWithState(context.namespaceId, taskInfo.id);

			expect(row?.state).toContainKey("output");
			expect(row?.state).toEqual({ status: "completed", attempts: 1, output: undefined });
		}));
});

describe("task repository compare-and-swap guards", () => {
	test("update leaves the task untouched when the expected status does not match", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			const rowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });

			const updated = await repos.task.update(
				{ id: taskInfo.id, workflowRunId: runId, status: "awaiting_retry", attempts: 1 },
				{ status: "running", attempts: 2 }
			);

			expect(updated).toBeNull();
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(rowBefore);
		}));

	test("update leaves the task untouched when the expected attempts do not match", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			// A retry is the one transition that keeps the status and bumps attempts —
			// the change a status-only guard cannot see.
			const taskStateMachine = createTaskStateMachine({ repos });
			await taskStateMachine.transitionState(context, {
				type: "retry",
				id: taskInfo.id,
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				taskState: { status: "running", attempts: 2 },
			});
			const rowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });

			const updated = await repos.task.update(
				{ id: taskInfo.id, workflowRunId: runId, status: "running", attempts: 1 },
				{ status: "completed", attempts: 1 }
			);

			expect(updated).toBeNull();
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(rowBefore);
		}));

	test("bulkDiscard skips a task whose attempts moved past the expected value", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachine({ repos });
			await taskStateMachine.transitionState(context, {
				type: "retry",
				id: taskInfo.id,
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				taskState: { status: "running", attempts: 2 },
			});
			const rowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });

			const discardedTaskIds = await repos.task.bulkDiscard([
				{
					filter: { id: taskInfo.id, workflowRunId: runId, status: "running", attempts: 1 },
					update: { latestStateTransitionId: "never-applied" },
				},
			]);

			expect(discardedTaskIds).toEqual([]);
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(rowBefore);
		}));

	test("bulkDiscard discards only the tasks whose expected status still matches", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const staleTaskSeed = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const completedTaskSeed = await seedCompletedTask({ namespaceRequestContext: context, repos, publisher });
			const completedRowBefore = await repos.task.getById({
				id: completedTaskSeed.taskInfo.id,
				workflowRunId: completedTaskSeed.runId,
			});

			// Both discards expect "running" — the read-time status. The completed row keeps
			// attempts 1, so only its status differs and its discard must match nothing.
			const staleTransitionId = "stale-transition-1";
			const discardedTaskIds = await repos.task.bulkDiscard([
				{
					filter: { id: staleTaskSeed.taskInfo.id, workflowRunId: staleTaskSeed.runId, status: "running", attempts: 1 },
					update: { latestStateTransitionId: staleTransitionId },
				},
				{
					filter: {
						id: completedTaskSeed.taskInfo.id,
						workflowRunId: completedTaskSeed.runId,
						status: "running",
						attempts: 1,
					},
					update: { latestStateTransitionId: "never-applied" },
				},
			]);

			expect(discardedTaskIds).toEqual([staleTaskSeed.taskInfo.id]);
			expect(await repos.task.getById({ id: staleTaskSeed.taskInfo.id, workflowRunId: staleTaskSeed.runId })).toEqual(
				expect.objectContaining({
					status: "discarded",
					nextAttemptAt: null,
					latestStateTransitionId: staleTransitionId,
				})
			);
			expect(
				await repos.task.getById({ id: completedTaskSeed.taskInfo.id, workflowRunId: completedTaskSeed.runId })
			).toEqual(completedRowBefore);
		}));
});
