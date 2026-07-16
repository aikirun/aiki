import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory, workflowRunStateByStatus } from "@aikirun/testing/workflow/run";
import type {
	ChildWorkflowRunWait,
	ChildWorkflowRunWaitQueue,
	TerminalWorkflowRunStatus,
} from "@aikirun/types/workflow/run";
import { WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";

import { workflowRunHandle } from "./handle";
import { childWorkflowRunHandle } from "./handle-child";
import { describe, expect, test } from "bun:test";

function childWaitQueues(
	waits: Partial<Record<TerminalWorkflowRunStatus, ChildWorkflowRunWait[]>>
): Record<TerminalWorkflowRunStatus, ChildWorkflowRunWaitQueue> {
	return {
		cancelled: { childWorkflowRunWaits: waits.cancelled ?? [] },
		completed: { childWorkflowRunWaits: waits.completed ?? [] },
		failed: { childWorkflowRunWaits: waits.failed ?? [] },
	};
}

describe("childWorkflowRunHandle", () => {
	describe("waitForStatus", () => {
		test("returns success with the child state when it reached the expected status", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const queues = childWaitQueues({
					completed: [
						{ status: "completed", completedAt: 0, childWorkflowRunState: { status: "completed", output: "done" } },
					],
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, queues, client.logger);

				expect(await childHandle.waitForStatus("completed")).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("returns a timeout when the recorded wait timed out", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const queues = childWaitQueues({ completed: [{ status: "timeout", timedOutAt: 0 }] });
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, queues, client.logger);

				expect(await childHandle.waitForStatus("completed", { timeout: { minutes: 5 } })).toEqual({
					success: false,
					cause: "timeout",
				});
			}));

		test("returns run_terminated when the child reached a different terminal status", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const queues = childWaitQueues({
					completed: [
						{
							status: "completed",
							completedAt: 0,
							childWorkflowRunState: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
						},
					],
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, queues, client.logger);

				expect(await childHandle.waitForStatus("completed")).toEqual({ success: false, cause: "run_terminated" });
			}));

		test("transitions the parent to awaiting_child_workflow and suspends when no wait is recorded", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(
					client,
					childRecord,
					parentHandle,
					childWaitQueues({}),
					client.logger
				);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
							childWorkflowRunStatus: "completed",
						},
						expectedRevision: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				expect(childHandle.waitForStatus("completed")).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("carries the timeout into the parent transition", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(
					client,
					childRecord,
					parentHandle,
					childWaitQueues({}),
					client.logger
				);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
							childWorkflowRunStatus: "completed",
							timeoutInMs: 300_000,
						},
						expectedRevision: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				expect(childHandle.waitForStatus("completed", { timeout: { minutes: 5 } })).rejects.toBeInstanceOf(
					WorkflowRunSuspendedError
				);
			}));

		test("maps a parent-transition conflict to a suspension", () =>
			withFakeClient((client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build({ revision: 0 });
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(
					client,
					childRecord,
					parentHandle,
					childWaitQueues({}),
					client.logger
				);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
							childWorkflowRunStatus: "completed",
						},
						expectedRevision: 0,
					},
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				expect(childHandle.waitForStatus("completed")).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("advances the cursor across calls for the same status", () =>
			withFakeClient(async (client) => {
				const parentRecord = runningWorkflowRunRecordFactory.build();
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentHandle = workflowRunHandle(client, parentRecord);
				const queues = childWaitQueues({
					completed: [
						{ status: "completed", completedAt: 0, childWorkflowRunState: { status: "completed", output: "first" } },
						{
							status: "completed",
							completedAt: 0,
							childWorkflowRunState: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
						},
					],
				});
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, queues, client.logger);

				expect(await childHandle.waitForStatus("completed")).toEqual({
					success: true,
					state: { status: "completed", output: "first" },
				});
				expect(await childHandle.waitForStatus("completed")).toEqual({ success: false, cause: "run_terminated" });
			}));
	});

	test("exposes the child run", () =>
		withFakeClient((client) => {
			const parentRecord = runningWorkflowRunRecordFactory.build();
			const childRecord = runningWorkflowRunRecordFactory.build();
			const parentHandle = workflowRunHandle(client, parentRecord);
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaitQueues({}), client.logger);

			expect(childHandle.run).toEqual(childRecord);
		}));

	test("cancels the child run, not the parent", () =>
		withFakeClient(async (client) => {
			const parentRecord = runningWorkflowRunRecordFactory.build();
			const childRecord = runningWorkflowRunRecordFactory.build({ revision: 2 });
			const parentHandle = workflowRunHandle(client, parentRecord);
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, childWaitQueues({}), client.logger);

			client.api.workflowRun.transitionStateV1.once(
				{ type: "pessimistic", id: childRecord.id, state: { status: "cancelled", reason: "stop it" } },
				{ revision: 3, state: { status: "cancelled" }, attempts: childRecord.attempts }
			);

			await childHandle.cancel("stop it");
		}));
});
