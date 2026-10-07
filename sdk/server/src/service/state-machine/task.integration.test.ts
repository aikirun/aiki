import { NotFoundError, ValidationError } from "@aikirun/lib/error";
import { MAX_TIMESTAMP_MS } from "@aikirun/lib/timestamp";
import { asOpaquePayload } from "@aikirun/testing/payload";
import type { NamespaceId } from "@aikirun/types/namespace";
import { describe, expect, test } from "vitest";

import { createTaskStateMachine } from "./task";
import { withFakeClock } from "../../testing/clock";
import { namespaceRequestContextFactory } from "../../testing/data-factory/middleware/context";
import { createServiceHarness } from "../../testing/harness";
import { seedClaimedRun } from "../../testing/seed/run";
import { seedRunningTask } from "../../testing/seed/task";

const withHarness = createServiceHarness();

describe("TaskStateMachine transitionState", () => {
	test("accepts a retry delay that puts the next attempt in the last millisecond of the year 9999", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			const taskStateMachine = createTaskStateMachine({ repos });
			const now = Date.now();

			await withFakeClock(now, () =>
				taskStateMachine.transitionState(context, {
					workflowRunId: runId,
					expectedWorkflowRunRevision: revisionWhenClaimed,
					sequence: latestTaskSequence + 1,
					id: taskInfo.id,
					attempts: taskInfo.attempts,
					state: {
						status: "awaiting_retry",
						error: { name: "Error", message: "declined" },
						nextAttemptInMs: MAX_TIMESTAMP_MS - now,
					},
				})
			);

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual([
				expect.objectContaining({
					id: taskInfo.id,
					state: expect.objectContaining({ status: "awaiting_retry", nextAttemptAt: MAX_TIMESTAMP_MS }),
				}),
			]);
		}));

	test("refuses a retry delay that puts the next attempt after the year 9999", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			const taskStateMachine = createTaskStateMachine({ repos });
			const now = Date.now();

			const transitioning = withFakeClock(now, () =>
				taskStateMachine.transitionState(context, {
					workflowRunId: runId,
					expectedWorkflowRunRevision: revisionWhenClaimed,
					sequence: latestTaskSequence + 1,
					id: taskInfo.id,
					attempts: taskInfo.attempts,
					state: {
						status: "awaiting_retry",
						error: { name: "Error", message: "declined" },
						nextAttemptInMs: MAX_TIMESTAMP_MS - now + 1,
					},
				})
			);

			await expect(transitioning).rejects.toThrow(ValidationError);
			await expect(transitioning).rejects.toThrow("The retry delay is too long");
		}));

	test("retries a running task as the same attempt", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});

			const taskStateMachine = createTaskStateMachine({ repos });
			await taskStateMachine.transitionState(context, {
				type: "retry",
				workflowRunId: runId,
				expectedWorkflowRunRevision: revisionWhenClaimed,
				sequence: latestTaskSequence + 1,
				id: taskInfo.id,
				attempts: taskInfo.attempts,
			});

			expect(await repos.task.listByWorkflowRunIdWithState(runId)).toEqual([
				expect.objectContaining({ id: taskInfo.id, attempts: taskInfo.attempts, state: { status: "running" } }),
			]);
			const { rows } = await repos.stateTransition.listByRunId(runId, 50, 0, { order: "asc" });
			expect(rows.filter((row) => row.type === "task")).toEqual([
				expect.objectContaining({
					taskId: taskInfo.id,
					taskSequence: latestTaskSequence,
					attempt: taskInfo.attempts,
					state: { status: "running" },
				}),
				expect.objectContaining({
					taskId: taskInfo.id,
					taskSequence: latestTaskSequence + 1,
					attempt: taskInfo.attempts,
					state: { status: "running" },
				}),
			]);
		}));

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

			const taskStateMachine = createTaskStateMachine({ repos });
			await expect(
				taskStateMachine.transitionState(context, {
					workflowRunId: attackerRunSeed.runId,
					expectedWorkflowRunRevision: attackerRunSeed.revisionWhenClaimed,
					sequence: 1,
					id: victimTaskSeed.taskInfo.id,
					attempts: 2,
					state: { status: "completed", output: asOpaquePayload("hijacked") },
				})
			).rejects.toBeInstanceOf(NotFoundError);

			expect(await repos.task.getById({ id: victimTaskSeed.taskInfo.id, workflowRunId: victimTaskSeed.runId })).toEqual(
				victimRowBefore
			);
		}));
});
