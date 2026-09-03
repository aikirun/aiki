import { NotFoundError } from "@aikirun/lib/error";
import type { NamespaceId } from "@aikirun/types/namespace";

import { createTaskStateMachine } from "./state-machine/task";
import { describe, expect, test } from "bun:test";
import { InvalidTaskStateTransitionError, WorkflowRunTerminatedError } from "../errors";
import { createTaskService } from "../service/task";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { completeRun, seedClaimedRun } from "../testing/seed/run";
import { seedCompletedTask, seedRunningTask } from "../testing/seed/task";

const withHarness = createServiceHarness();

describe("TaskService getTaskById", () => {
	test("returns the task record", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo, taskInput } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskService = createTaskService({ repos });
			expect(await taskService.getTaskById(context, taskInfo.id)).toEqual({
				id: taskInfo.id,
				name: taskInfo.name,
				workflowRunId: runId,
				input: taskInput,
				inputHash: taskInfo.inputHash,
				options: undefined,
				attempts: 1,
				state: { status: "running" },
			});
		}));

	test("returns the task's latest state", () =>
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
				attempts: 2,
			});

			const taskService = createTaskService({ repos });
			expect(await taskService.getTaskById(context, taskInfo.id)).toEqual(
				expect.objectContaining({ id: taskInfo.id, attempts: 2, state: { status: "running" } })
			);
		}));

	test("does not return a task from another namespace", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const otherNamespaceContext = namespaceRequestContextFactory.build({ namespaceId: "other-ns" as NamespaceId });
			const foreignTaskSeed = await seedRunningTask({
				namespaceRequestContext: otherNamespaceContext,
				repos,
				publisher,
			});

			const taskService = createTaskService({ repos });
			expect(taskService.getTaskById(context, foreignTaskSeed.taskInfo.id)).rejects.toBeInstanceOf(NotFoundError);
		}));
});

describe("TaskService setTaskState", () => {
	test("completes a running task with the request's output", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const output = { reservationId: "rsv-1" };
			const taskService = createTaskService({ repos });
			await taskService.setTaskState(context, {
				id: taskInfo.id,
				workflowRunId: runId,
				state: { status: "completed", output },
			});

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual([
				expect.objectContaining({
					id: taskInfo.id,
					attempts: 2,
					state: { status: "completed", output },
				}),
			]);
		}));

	test("fails a running task with the request's error", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const error = { name: "Error", message: "inventory system unreachable" };
			const taskService = createTaskService({ repos });
			await taskService.setTaskState(context, {
				id: taskInfo.id,
				workflowRunId: runId,
				state: { status: "failed", error },
			});

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual([
				expect.objectContaining({
					id: taskInfo.id,
					attempts: 2,
					state: { status: "failed", error },
				}),
			]);
		}));

	test("does not set the state of a task belonging to another run", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const otherNamespaceContext = namespaceRequestContextFactory.build({ namespaceId: "other-ns" as NamespaceId });
			const victimTaskSeed = await seedRunningTask({
				namespaceRequestContext: otherNamespaceContext,
				repos,
				publisher,
			});
			const victimRowBefore = await repos.task.getById({
				id: victimTaskSeed.taskInfo.id,
				workflowRunId: victimTaskSeed.runId,
			});

			// The attacker holds a perfectly valid run of their own; only the task is foreign.
			const attackerRunSeed = await seedClaimedRun({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskService = createTaskService({ repos });
			expect(
				taskService.setTaskState(context, {
					id: victimTaskSeed.taskInfo.id,
					workflowRunId: attackerRunSeed.runId,
					state: { status: "completed", output: "hijacked" },
				})
			).rejects.toBeInstanceOf(NotFoundError);

			expect(await repos.task.getById({ id: victimTaskSeed.taskInfo.id, workflowRunId: victimTaskSeed.runId })).toEqual(
				victimRowBefore
			);
		}));

	test("does not set an existing task's state on a run that has already finished", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			await completeRun({ context, repos, runId, expectedRevision: revisionWhenClaimed });
			const taskRowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });
			expect(taskRowBefore).toEqual(expect.objectContaining({ id: taskInfo.id, status: "running" }));

			const taskService = createTaskService({ repos });
			expect(
				taskService.setTaskState(context, {
					id: taskInfo.id,
					workflowRunId: runId,
					state: { status: "completed", output: { reservationId: "rsv-1" } },
				})
			).rejects.toBeInstanceOf(WorkflowRunTerminatedError);

			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(taskRowBefore);
		}));

	test("does not reopen a task that already reached a terminal state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedCompletedTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			const taskRowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });
			expect(taskRowBefore).toEqual(expect.objectContaining({ id: taskInfo.id, status: "completed" }));

			const taskService = createTaskService({ repos });
			expect(
				taskService.setTaskState(context, {
					id: taskInfo.id,
					workflowRunId: runId,
					state: { status: "failed", error: { name: "Error", message: "boom" } },
				})
			).rejects.toBeInstanceOf(InvalidTaskStateTransitionError);

			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(taskRowBefore);
		}));

	test("does not resolve a task that is waiting for its retry", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachine({ repos });
			await taskStateMachine.transitionState(context, {
				id: taskInfo.id,
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				attempts: 1,
				state: {
					status: "awaiting_retry",
					error: { name: "Error", message: "boom" },
					nextAttemptInMs: 60_000,
				},
			});
			const taskRowBefore = await repos.task.getById({ id: taskInfo.id, workflowRunId: runId });
			expect(taskRowBefore).toEqual(expect.objectContaining({ id: taskInfo.id, status: "awaiting_retry" }));

			const taskService = createTaskService({ repos });
			expect(
				taskService.setTaskState(context, {
					id: taskInfo.id,
					workflowRunId: runId,
					state: { status: "failed", error: { name: "Error", message: "boom" } },
				})
			).rejects.toBeInstanceOf(InvalidTaskStateTransitionError);

			expect(await repos.task.getById({ id: taskInfo.id, workflowRunId: runId })).toEqual(taskRowBefore);
		}));
});
