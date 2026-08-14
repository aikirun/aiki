import { NotFoundError } from "@aikirun/lib/error";
import type { NamespaceId } from "@aikirun/types/namespace";

import { describe, expect, test } from "bun:test";
import { createTaskService } from "../service/task";
import { createTaskStateMachineService } from "../service/task-state-machine";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { seedRunningTask } from "../testing/seed/task";

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
				state: { status: "running", attempts: 1 },
			});
		}));

	test("returns the task's latest state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachineService({ repos });
			await taskStateMachine.transitionState(context, {
				type: "retry",
				id: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				taskId: taskInfo.id,
				taskState: { status: "running", attempts: 2 },
			});

			const taskService = createTaskService({ repos });
			expect(await taskService.getTaskById(context, taskInfo.id)).toEqual(
				expect.objectContaining({ id: taskInfo.id, state: { status: "running", attempts: 2 } })
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
