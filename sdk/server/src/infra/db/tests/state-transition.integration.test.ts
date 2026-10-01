import type { NamespaceId } from "@aikirun/types/namespace";
import { ulid } from "ulidx";

import { describe, expect, test } from "bun:test";
import { createChildRunCanceller } from "../../../service/cancel-child-runs";
import { createScheduleService } from "../../../service/schedule";
import { createWorkflowRunStateMachine } from "../../../service/state-machine/workflow-run";
import { createServiceHarness } from "../../../testing/harness";
import { seedClaimedRun, seedCompletedRun, seedScheduledRun } from "../../../testing/seed/run";
import { seedActiveSchedule } from "../../../testing/seed/schedule";
import {
	seedAwaitingTaskRetryRun,
	seedCompletedTask,
	seedRunningTask,
	seedSiblingAwaitingRetryTasks,
} from "../../../testing/seed/task";
import type { Repositories } from "../types";

const withHarness = createServiceHarness();

const ONE_MINUTE = 60_000;

function orderById(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : 1;
}

async function getRunLatestTransitionId(repos: Repositories, namespaceId: NamespaceId, runId: string): Promise<string> {
	const result = await repos.workflowRun.getByIdWithState({ namespaceId, id: runId });
	if (!result) {
		throw new Error(`Run not found: ${runId}`);
	}
	return result.run.latestStateTransitionId;
}

async function getTaskLatestTransitionId(
	repos: Repositories,
	params: { id: string; workflowRunId: string }
): Promise<string> {
	const row = await repos.task.getById(params);
	if (!row) {
		throw new Error(`Task not found: ${params.id}`);
	}
	return row.latestStateTransitionId;
}

async function getScheduleLatestTransitionId(
	repos: Repositories,
	namespaceId: NamespaceId,
	scheduleId: string
): Promise<string> {
	const row = await repos.schedule.get(namespaceId, { id: scheduleId });
	if (!row) {
		throw new Error(`Schedule not found: ${scheduleId}`);
	}
	return row.latestStateTransitionId;
}

describe("state transition repository getById", () => {
	test("returns null for an unknown id", () =>
		withHarness(async ({ repos }) => {
			const absentTransitionId = ulid();

			expect(await repos.stateTransition.getById(absentTransitionId)).toBeNull();
		}));

	test("returns a run's transition with its state", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedClaimedRun({ namespaceRequestContext: context, repos, publisher });
			const transitionId = await getRunLatestTransitionId(repos, context.namespaceId, runId);

			expect(await repos.stateTransition.getById(transitionId)).toEqual(
				expect.objectContaining({
					id: transitionId,
					type: "workflow_run",
					workflowRunId: runId,
					attempt: 1,
					taskId: null,
					scheduleId: null,
					status: "running",
					state: { status: "running" },
				})
			);
		}));

	test("returns a task's transition with its task id", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const transitionId = await getTaskLatestTransitionId(repos, { id: taskInfo.id, workflowRunId: runId });

			expect(await repos.stateTransition.getById(transitionId)).toEqual(
				expect.objectContaining({
					id: transitionId,
					type: "task",
					taskId: taskInfo.id,
					workflowRunId: runId,
					attempt: 1,
					scheduleId: null,
					status: "running",
					state: { status: "running" },
				})
			);
		}));

	test("returns a schedule's transition", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const transitionId = await getScheduleLatestTransitionId(repos, context.namespaceId, schedule.id);

			expect(await repos.stateTransition.getById(transitionId)).toEqual(
				expect.objectContaining({
					id: transitionId,
					type: "schedule",
					scheduleId: schedule.id,
					workflowRunId: null,
					attempt: null,
					taskId: null,
					status: "active",
					state: { status: "active", reason: "activated" },
				})
			);
		}));

	test("returns a completed run's state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ output: undefined }
			);
			const transitionId = await getRunLatestTransitionId(repos, context.namespaceId, runId);

			const row = await repos.stateTransition.getById(transitionId);

			expect(row?.state).toHaveProperty("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));

	test("returns a completed task's state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedCompletedTask(
				{ namespaceRequestContext: context, repos, publisher },
				{ output: undefined }
			);
			const transitionId = await getTaskLatestTransitionId(repos, { id: taskInfo.id, workflowRunId: runId });

			const row = await repos.stateTransition.getById(transitionId);

			expect(row?.state).toHaveProperty("output");
			expect(row?.state).toEqual({ status: "completed", output: undefined });
		}));
});

describe("state transition repository getByIds", () => {
	test("returns each known id's transition, whatever its type, and ignores unknown ids", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const runTransitionId = await getRunLatestTransitionId(repos, context.namespaceId, runId);
			const taskTransitionId = await getTaskLatestTransitionId(repos, { id: taskInfo.id, workflowRunId: runId });
			const scheduleTransitionId = await getScheduleLatestTransitionId(repos, context.namespaceId, schedule.id);
			const absentTransitionId = ulid();

			const rows = await repos.stateTransition.getByIds([
				runTransitionId,
				taskTransitionId,
				scheduleTransitionId,
				absentTransitionId,
			]);

			expect([...rows].sort(orderById)).toEqual(
				[
					{
						id: runTransitionId,
						type: "workflow_run",
						workflowRunId: runId,
						attempt: 1,
						taskId: null,
						scheduleId: null,
						status: "running",
						state: { status: "running" },
					},
					{
						id: taskTransitionId,
						type: "task",
						workflowRunId: runId,
						attempt: 1,
						taskId: taskInfo.id,
						scheduleId: null,
						status: "running",
						state: { status: "running" },
					},
					{
						id: scheduleTransitionId,
						type: "schedule",
						workflowRunId: null,
						attempt: null,
						taskId: null,
						scheduleId: schedule.id,
						status: "active",
						state: { status: "active", reason: "activated" },
					},
				]
					.sort(orderById)
					.map((row) => expect.objectContaining(row))
			);
		}));

	test("returns a completed run's state carrying the output key", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedCompletedRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ output: undefined }
			);
			const transitionId = await getRunLatestTransitionId(repos, context.namespaceId, runId);

			const rows = await repos.stateTransition.getByIds([transitionId]);

			expect(rows).toEqual([expect.objectContaining({ id: transitionId, state: { status: "completed" } })]);
			expect(rows.find((row) => row.id === transitionId)?.state).toHaveProperty("output");
		}));
});

describe("state transition repository getLatestTaskSequence", () => {
	test("returns the highest task sequence among the revision's tasks", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed } = await seedSiblingAwaitingRetryTasks(
				{ namespaceRequestContext: context, repos, publisher },
				{ firstNextAttemptAt: 3_000_000, siblingNextAttemptAt: 4_000_000 }
			);

			// The seed's worker sent the first task's creation and retry wait as 1 and 2, then its
			// sibling's as 3 and 4.
			expect(await repos.stateTransition.getLatestTaskSequence(runId, revisionWhenClaimed)).toBe(4);
		}));

	test("returns null at a revision no task transition was written at, even when an earlier revision has some", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenParked } = await seedAwaitingTaskRetryRun(
				{ namespaceRequestContext: context, repos, publisher },
				{ nextAttemptAt: 3_000_000 }
			);

			expect(await repos.stateTransition.getLatestTaskSequence(runId, revisionWhenParked)).toBeNull();
		}));
});

describe("state transition repository listByRunId", () => {
	test("lists the run's own and its tasks' transitions newest first with the total", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });

			expect(await repos.stateTransition.listByRunId(runId)).toEqual({
				rows: [
					expect.objectContaining({ type: "task", taskId: taskInfo.id, workflowRunId: runId, status: "running" }),
					expect.objectContaining({ type: "workflow_run", workflowRunId: runId, status: "running" }),
					expect.objectContaining({ type: "workflow_run", workflowRunId: runId, status: "queued" }),
					expect.objectContaining({ type: "workflow_run", workflowRunId: runId, status: "scheduled" }),
				],
				total: 4,
			});
		}));

	test("lists oldest first when asked", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });

			expect(await repos.stateTransition.listByRunId(runId, 50, 0, { order: "asc" })).toEqual({
				rows: [
					expect.objectContaining({ type: "workflow_run", status: "scheduled" }),
					expect.objectContaining({ type: "workflow_run", status: "queued" }),
					expect.objectContaining({ type: "workflow_run", status: "running" }),
					expect.objectContaining({ type: "task", taskId: taskInfo.id, status: "running" }),
				],
				total: 4,
			});
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });

			expect(await repos.stateTransition.listByRunId(runId, 1, 1)).toEqual({
				rows: [expect.objectContaining({ type: "workflow_run", status: "running" })],
				total: 4,
			});
		}));

	test("lists a revision's task transitions after its run transition, in sequence order whatever their ids", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, revisionWhenClaimed, taskInfo, latestTaskSequence } = await seedRunningTask({
				namespaceRequestContext: context,
				repos,
				publisher,
			});
			const runningTransitionId = await getRunLatestTransitionId(repos, context.namespaceId, runId);
			const createdTaskTransitionId = await getTaskLatestTransitionId(repos, { id: taskInfo.id, workflowRunId: runId });
			const olderTaskTransitionId = ulid(Date.now() - ONE_MINUTE);
			await repos.stateTransition.append({
				id: olderTaskTransitionId,
				workflowRunId: runId,
				type: "task",
				taskId: taskInfo.id,
				attempt: 1,
				revision: revisionWhenClaimed,
				taskSequence: latestTaskSequence + 1,
				state: { status: "completed" },
			});

			const { rows } = await repos.stateTransition.listByRunId(runId, 50, 0, { order: "asc" });

			expect(rows.map((row) => row.id).slice(2)).toEqual([
				runningTransitionId,
				createdTaskTransitionId,
				olderTaskTransitionId,
			]);
		}));

	test("lists a discarded task right after the run transition that discarded it", () =>
		withHarness(async ({ context, repos, publisher }) => {
			const { runId, taskInfo } = await seedRunningTask({ namespaceRequestContext: context, repos, publisher });
			const workflowRunStateMachine = createWorkflowRunStateMachine({
				repos,
				childRunCanceller: createChildRunCanceller(),
			});
			await workflowRunStateMachine.transitionState(context, {
				type: "pessimistic",
				id: runId,
				state: { status: "cancelled" },
			});

			const { rows } = await repos.stateTransition.listByRunId(runId, 2);

			expect(rows).toEqual([
				expect.objectContaining({ type: "task", taskId: taskInfo.id, status: "discarded" }),
				expect.objectContaining({ type: "workflow_run", status: "cancelled" }),
			]);
		}));

	test("leaves out other runs' transitions", () =>
		withHarness(async ({ context, repos }) => {
			const { runId } = await seedScheduledRun({ repos, namespaceRequestContext: context });
			await seedScheduledRun({ repos, namespaceRequestContext: context });

			expect(await repos.stateTransition.listByRunId(runId)).toEqual({
				rows: [expect.objectContaining({ workflowRunId: runId, status: "scheduled" })],
				total: 1,
			});
		}));
});

describe("state transition repository listByScheduleId", () => {
	test("lists the schedule's transitions newest first with the total", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const scheduleService = createScheduleService({ repos });
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
				rows: [
					expect.objectContaining({ type: "schedule", scheduleId: schedule.id, state: { status: "paused" } }),
					expect.objectContaining({
						type: "schedule",
						scheduleId: schedule.id,
						state: { status: "active", reason: "activated" },
					}),
				],
				total: 2,
			});
		}));

	test("lists oldest first when asked", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const scheduleService = createScheduleService({ repos });
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);

			expect(await repos.stateTransition.listByScheduleId(schedule.id, 50, 0, { order: "asc" })).toEqual({
				rows: [
					expect.objectContaining({ scheduleId: schedule.id, state: { status: "active", reason: "activated" } }),
					expect.objectContaining({ scheduleId: schedule.id, state: { status: "paused" } }),
				],
				total: 2,
			});
		}));

	test("pages by limit and offset and still reports the full total", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const scheduleService = createScheduleService({ repos });
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);
			await scheduleService.resumeSchedule(context.namespaceId, schedule.id);

			expect(await repos.stateTransition.listByScheduleId(schedule.id, 1, 1)).toEqual({
				rows: [expect.objectContaining({ scheduleId: schedule.id, state: { status: "paused" } })],
				total: 3,
			});
		}));

	test("lists a transition by its revision even when its id is older", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			const scheduleService = createScheduleService({ repos });
			await scheduleService.pauseSchedule(context.namespaceId, schedule.id);
			const pausedRow = await repos.schedule.get(context.namespaceId, { id: schedule.id });
			if (!pausedRow) {
				throw new Error(`Schedule not found: ${schedule.id}`);
			}
			const olderResumeTransitionId = ulid(Date.now() - ONE_MINUTE);
			await repos.stateTransition.append({
				id: olderResumeTransitionId,
				type: "schedule",
				scheduleId: schedule.id,
				revision: pausedRow.revision + 1,
				state: { status: "active", reason: "resumed" },
			});

			expect(await repos.stateTransition.listByScheduleId(schedule.id, 50, 0, { order: "asc" })).toEqual({
				rows: [
					expect.objectContaining({ state: { status: "active", reason: "activated" } }),
					expect.objectContaining({ state: { status: "paused" } }),
					expect.objectContaining({ id: olderResumeTransitionId }),
				],
				total: 3,
			});
		}));

	test("leaves out other schedules' transitions", () =>
		withHarness(async ({ context, repos }) => {
			const { schedule } = await seedActiveSchedule({ repos, namespaceRequestContext: context });
			await seedActiveSchedule({ repos, namespaceRequestContext: context }, { workflowName: "reconcile-ledger" });

			expect(await repos.stateTransition.listByScheduleId(schedule.id)).toEqual({
				rows: [expect.objectContaining({ scheduleId: schedule.id, state: { status: "active", reason: "activated" } })],
				total: 1,
			});
		}));
});
