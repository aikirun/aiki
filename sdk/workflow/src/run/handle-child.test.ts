import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory, workflowRunStateByStatus } from "@aikirun/testing/data-factory/workflow/run";
import type { ChildWorkflowRunWaits } from "@aikirun/types/workflow/run";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import { workflowRunHandle } from "./handle";
import { childWorkflowRunHandle } from "./handle-child";
import { describe, expect, test } from "bun:test";

function childWaits(waits: Partial<ChildWorkflowRunWaits>): ChildWorkflowRunWaits {
	return {
		timeouts: waits.timeouts ?? [],
		...(waits.terminal !== undefined ? { terminal: waits.terminal } : {}),
	};
}

describe("childWorkflowRunHandle", () => {
	describe("wait", () => {
		test("resolves with the child's terminal state", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const waits = childWaits({
					terminal: { state: { status: "completed", output: "done" }, completedAt: 1_000 },
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, waits, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("resolves with whatever terminal state the child reached", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const waits = childWaits({
					terminal: {
						state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
						completedAt: 1_000,
					},
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, waits, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
				});
			}));

		test("repeated waits read the same terminal outcome", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const waits = childWaits({
					terminal: { state: { status: "completed", output: "done" }, completedAt: 1_000 },
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, waits, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("returns a timeout when the recorded wait timed out", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const waits = childWaits({ timeouts: [{ timedOutAt: 1_000 }] });
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, waits, client.logger);

				expect(await childHandle.wait({ timeout: { minutes: 5 } })).toEqual({
					success: false,
					cause: "timeout",
				});
			}));

		test("consumes the recorded timeout before reading the terminal outcome", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const waits = childWaits({
					timeouts: [{ timedOutAt: 1_000 }],
					terminal: { state: { status: "completed", output: "done" }, completedAt: 2_000 },
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, waits, client.logger);

				expect(await childHandle.wait({ timeout: { minutes: 5 } })).toEqual({
					success: false,
					cause: "timeout",
				});
				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("transitions the parent to awaiting_child_workflow and suspends when no wait is recorded", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaits({}), client.logger);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
						},
						expectedRevision: 0,
						expectedSignalSequence: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				expect(childHandle.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("carries the timeout into the parent transition", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaits({}), client.logger);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
							timeoutInMs: 300_000,
						},
						expectedRevision: 0,
						expectedSignalSequence: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				expect(childHandle.wait({ timeout: { minutes: 5 } })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("maps a parent-transition conflict to a suspension", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaits({}), client.logger);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
						},
						expectedRevision: 0,
						expectedSignalSequence: 0,
					},
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				expect(childHandle.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));
	});

	test("exposes the child run", () =>
		withFakeClient((client) => {
			const parentRecord = runningWorkflowRunRecordFactory.build();
			const childRecord = runningWorkflowRunRecordFactory.build();
			const parentHandle = workflowRunHandle(client, parentRecord);
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaits({}), client.logger);

			expect(childHandle.run).toEqual(childRecord);
		}));

	test("cancels the child run, not the parent", () =>
		withFakeClient(async (client) => {
			const parentRecord = runningWorkflowRunRecordFactory.build();
			const childRecord = runningWorkflowRunRecordFactory.build({ revision: 2 });
			const parentHandle = workflowRunHandle(client, parentRecord);
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaits({}), client.logger);

			client.api.workflowRun.transitionStateV1.once(
				{ type: "pessimistic", id: childRecord.id, state: { status: "cancelled", explanation: "stop it" } },
				{ revision: 3, state: { status: "cancelled" }, attempts: childRecord.attempts }
			);

			await childHandle.cancel("stop it");
		}));
});
