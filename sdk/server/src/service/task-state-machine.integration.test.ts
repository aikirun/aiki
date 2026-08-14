import { NotFoundError } from "@aikirun/lib/error";
import type { NamespaceId } from "@aikirun/types/namespace";

import { describe, expect, test } from "bun:test";
import { createTaskStateMachineService } from "../service/task-state-machine";
import { namespaceRequestContextFactory } from "../testing/data-factory/middleware/context";
import { createServiceHarness } from "../testing/harness";
import { seedClaimedRun } from "../testing/seed/run";
import { seedRunningTask } from "../testing/seed/task";

const withHarness = createServiceHarness();

describe("TaskStateMachineService transitionState", () => {
	test("does not transition a task belonging to another run", () =>
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

			const taskStateMachine = createTaskStateMachineService({ repos });
			expect(
				taskStateMachine.transitionState(context, {
					workflowRunId: attackerRunSeed.runId,
					expectedWorkflowRunRevision: attackerRunSeed.revisionWhenClaimed,
					id: victimTaskSeed.taskInfo.id,
					taskState: { status: "completed", attempts: 2, output: "hijacked" },
				})
			).rejects.toBeInstanceOf(NotFoundError);

			expect(await repos.task.getById({ id: victimTaskSeed.taskInfo.id, workflowRunId: victimTaskSeed.runId })).toEqual(
				victimRowBefore
			);
		}));
});
