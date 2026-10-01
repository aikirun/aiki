import type { TimestampMs } from "@aikirun/lib/timestamp";
import { ulid } from "ulidx";

import { describe, expect, test } from "bun:test";
import { createTaskStateMachine } from "../../../service/state-machine/task";
import { namespaceRequestContextFactory } from "../../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../../testing/harness";
import { seedClaimedRun } from "../../../testing/seed/run";
import {
	seedAwaitingRetryTask,
	seedCompletedTask,
	seedDiscardedTask,
	seedRunningTask,
	seedRunningTaskOnRun,
	seedSiblingAwaitingRetryTasks,
} from "../../../testing/seed/task";

const withHarness = createServiceHarness();

function orderById(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : 1;
}

describe("task repository getByIdWithState", () => {
	test("returns a completed state carrying the output key", () =>
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
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));

	test("finds a task only through its own namespace", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const otherNamespaceId = namespaceRequestContextFactory.build().namespaceId;
			const absentTaskId = ulid();

			expect(await repos.task.getByIdWithState(context.namespaceId, taskInfo.id)).toEqual(
				expect.objectContaining({
					id: taskInfo.id,
					name: taskInfo.name,
					workflowRunId: runId,
					attempts: 1,
					state: { status: "running" },
				})
			);
			expect(await repos.task.getByIdWithState(otherNamespaceId, taskInfo.id)).toBeNull();
			expect(await repos.task.getByIdWithState(context.namespaceId, absentTaskId)).toBeNull();
		}));
});

describe("task repository update", () => {
	test("applies the update and returns the row when every expected value matches", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const completionTransitionId = ulid();

			const updated = await repos.task.update(
				{ id: taskInfo.id, workflowRunId: runId, status: "running", attempts: 1 },
				{ status: "completed", attempts: 1, latestStateTransitionId: completionTransitionId, nextAttemptAt: null }
			);

			expect(updated).toEqual(
				expect.objectContaining({
					id: taskInfo.id,
					status: "completed",
					attempts: 1,
					latestStateTransitionId: completionTransitionId,
					nextAttemptAt: null,
				})
			);
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(updated);
		}));

	test("leaves the task untouched when the expected status does not match", () =>
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

	test("leaves the task untouched when the expected attempts do not match", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
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
				sequence: latestTaskSequence + 1,
				attempts: 2,
			});
			const rowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });

			const updated = await repos.task.update(
				{ id: taskInfo.id, workflowRunId: runId, status: "running", attempts: 1 },
				{ status: "completed", attempts: 1 }
			);

			expect(updated).toBeNull();
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(rowBefore);
		}));
});

describe("task repository bulkTransitionToDiscarded", () => {
	test("skips a task whose attempts moved past the expected value", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
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
				sequence: latestTaskSequence + 1,
				attempts: 2,
			});
			const rowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });

			const discardedTaskIds = await repos.task.bulkTransitionToDiscarded([
				{
					filter: { id: taskInfo.id, workflowRunId: runId, status: "running", attempts: 1 },
					update: { latestStateTransitionId: "never-applied" },
				},
			]);

			expect(discardedTaskIds).toEqual([]);
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(rowBefore);
		}));

	test("discards only the tasks whose expected status still matches", () =>
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
			const discardedTaskIds = await repos.task.bulkTransitionToDiscarded([
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

describe("task repository listByWorkflowRunIdWithState", () => {
	test("lists the run's tasks in id order with each task's state, leaving out other runs' tasks", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { namespaceRequestContext: context, repos, publisher };
			const { runId, taskInfo, siblingTaskInfo } = await seedSiblingAwaitingRetryTasks(deps, {
				firstNextAttemptAt: 4_000_000,
				siblingNextAttemptAt: 3_000_000,
			});
			await seedRunningTask(deps);

			const expectedTasks = [
				{
					id: taskInfo.id,
					name: taskInfo.name,
					attempts: 1,
					state: {
						status: "awaiting_retry",
						error: { name: "Error", message: "inventory service unavailable" },
						nextAttemptAt: 4_000_000,
					},
				},
				{
					id: siblingTaskInfo.id,
					name: siblingTaskInfo.name,
					attempts: 1,
					state: {
						status: "awaiting_retry",
						error: { name: "Error", message: "payment gateway unavailable" },
						nextAttemptAt: 3_000_000,
					},
				},
			].sort((a, b) => (a.id < b.id ? -1 : 1));

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual(
				expectedTasks.map((expectedTask) => expect.objectContaining(expectedTask))
			);
		}));

	test("leaves out a discarded task", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedDiscardedTask({ namespaceRequestContext: context, repos, publisher });
			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(
				expect.objectContaining({ id: taskInfo.id, status: "discarded" })
			);

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual([]);
		}));
});

describe("task repository getEarliestNextAttemptAt", () => {
	test("returns the earliest deadline among the run's tasks awaiting retry", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedSiblingAwaitingRetryTasks(
				{ namespaceRequestContext: context, repos, publisher },
				{ firstNextAttemptAt: 4_000_000, siblingNextAttemptAt: 3_000_000 }
			);

			expect(await repos.task.getEarliestNextAttemptAt(runId)).toBe(3_000_000 as TimestampMs);
		}));

	test("returns null when no task on the run awaits a retry", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedTask({ namespaceRequestContext: context, repos, publisher });

			expect(await repos.task.getEarliestNextAttemptAt(runId)).toBeNull();
		}));

	test("ignores deadlines of tasks on other runs", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { namespaceRequestContext: context, repos, publisher };
			await seedAwaitingRetryTask(deps, { nextAttemptAt: 4_000_000 });
			const { runId: runningRunId } = await seedRunningTask(deps);

			expect(await repos.task.getEarliestNextAttemptAt(runningRunId)).toBeNull();
		}));
});

describe("task repository listByWorkflowRunIdsAndStatuses", () => {
	test("lists one run's tasks in the requested statuses", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, siblingTaskInfo } = await seedSiblingAwaitingRetryTasks(
				{ namespaceRequestContext: context, repos, publisher },
				{ firstNextAttemptAt: 4_000_000, siblingNextAttemptAt: 3_000_000 }
			);
			const runningTask = await seedRunningTaskOnRun(
				{ repos, namespaceRequestContext: context },
				{ runId, revisionWhenClaimed },
				{ taskName: "notify-customer", input: { customerId: "cus-5" } }
			);

			const awaitingRetryRows = await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["awaiting_retry"]);
			expect([...awaitingRetryRows].sort(orderById)).toEqual(
				[
					{ id: taskInfo.id, workflowRunId: runId, attempts: 1, status: "awaiting_retry" as const },
					{ id: siblingTaskInfo.id, workflowRunId: runId, attempts: 1, status: "awaiting_retry" as const },
				].sort(orderById)
			);
			expect(await repos.task.listByWorkflowRunIdsAndStatuses(runId, ["running"])).toEqual([
				{ id: runningTask.taskInfo.id, workflowRunId: runId, attempts: 1, status: "running" },
			]);
		}));

	test("lists tasks across several runs", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { namespaceRequestContext: context, repos, publisher };
			const firstRun = await seedRunningTask(deps);
			const secondRun = await seedRunningTask(deps);

			const rows = await repos.task.listByWorkflowRunIdsAndStatuses([firstRun.runId, secondRun.runId], ["running"]);

			expect([...rows].sort(orderById)).toEqual(
				[
					{ id: firstRun.taskInfo.id, workflowRunId: firstRun.runId, attempts: 1, status: "running" as const },
					{ id: secondRun.taskInfo.id, workflowRunId: secondRun.runId, attempts: 1, status: "running" as const },
				].sort(orderById)
			);
		}));
});

describe("task repository countByWorkflowRunIds", () => {
	test("counts each run's tasks by status with zeroes for the statuses it lacks, and omits runs with no tasks", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const deps = { namespaceRequestContext: context, repos, publisher };
			const retryingTasksRun = await seedSiblingAwaitingRetryTasks(deps, {
				firstNextAttemptAt: 4_000_000,
				siblingNextAttemptAt: 3_000_000,
			});
			await seedRunningTaskOnRun({ repos, namespaceRequestContext: context }, retryingTasksRun, {
				taskName: "notify-customer",
				input: { customerId: "cus-5" },
			});
			const completedTaskRun = await seedCompletedTask(deps);
			const tasklessRun = await seedClaimedRun(deps);

			const counts = await repos.task.countByWorkflowRunIds([
				retryingTasksRun.runId,
				completedTaskRun.runId,
				tasklessRun.runId,
			]);

			expect(counts).toEqual(
				new Map([
					[retryingTasksRun.runId, { completed: 0, running: 1, failed: 0, awaiting_retry: 2, discarded: 0 }],
					[completedTaskRun.runId, { completed: 1, running: 0, failed: 0, awaiting_retry: 0, discarded: 0 }],
				])
			);
		}));
});
