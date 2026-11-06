import { withFakeClient } from "@aikirun/testing/client";
import {
	baseWorkflowRunRecordFactory,
	runningWorkflowRunRecordFactory,
	workflowRunStateByStatus,
} from "@aikirun/testing/data-factory/workflow/run";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunId, WorkflowRunRecord } from "@aikirun/types/workflow/run";
import {
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { childWorkflowRunHandle } from "./child-workflow-run";
import { workflowRunHandle } from "./workflow-run";

describe("childWorkflowRunHandle", () => {
	describe("wait", () => {
		test("resolves with the child's terminal state", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [],
							terminal: { state: { status: "completed", output: asOpaquePayload("done") }, completedAt: 1_000 },
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("decodes the child's completed output through the child's codec, not the parent's", () =>
			withFakeClient(async (client) => {
				const storedOutput = asOpaquePayload({ stored: true });
				client[INTERNAL].codec = {
					encode: async (payload) => payload,
					decode: async (payload) => {
						expect(payload).toEqual(storedOutput);
						return "done";
					},
				};
				const childRecord = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });
				const parentRecord = runningWorkflowRunRecordFactory.build({
					clientCodecApplied: false,
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [],
							terminal: { state: { status: "completed", output: storedOutput }, completedAt: 1_000 },
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("decodes the child's completed output through the client codec then the definition output codec", () =>
			withFakeClient(async (client) => {
				const storedOutput = asOpaquePayload({ client: { def: "done" } });
				client[INTERNAL].codec = {
					encode: async (payload) => payload,
					decode: async (payload) => {
						expect(payload).toEqual(storedOutput);
						return { def: "done" };
					},
				};
				const childRecord = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [],
							terminal: { state: { status: "completed", output: storedOutput }, completedAt: 1_000 },
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger, {
					workflowCodec: {
						input: {
							encode: async (payload) => payload,
							decode: async () => "from-input",
						},
						output: {
							encode: async (payload) => payload,
							decode: async (payload) => {
								expect(payload).toEqual({ def: "done" });
								return "done";
							},
						},
					},
				});

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "completed", output: "done" },
				});
			}));

		test("resolves with whatever terminal state the child reached", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [],
							terminal: {
								state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
								completedAt: 1_000,
							},
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				expect(await childHandle.wait()).toEqual({
					success: true,
					state: { status: "failed", cause: "self", error: { name: "Error", message: "boom" } },
				});
			}));

		test("repeated waits read the same terminal outcome", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [],
							terminal: { state: { status: "completed", output: asOpaquePayload("done") }, completedAt: 1_000 },
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

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
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [{ timedOutAt: 1_000 }] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				expect(await childHandle.wait({ timeout: { minutes: 5 } })).toEqual({
					success: false,
					cause: "timeout",
				});
			}));

		test("consumes the recorded timeout before reading the terminal outcome", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: {
						[childRecord.id]: {
							timeouts: [{ timedOutAt: 1_000 }],
							terminal: { state: { status: "completed", output: asOpaquePayload("done") }, completedAt: 2_000 },
						},
					},
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

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
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
						},
						expectedRevision: parentRecord.revision,
						expectedSignalSequence: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				await expect(childHandle.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("carries the timeout into the parent transition", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				client.api.workflowRun.transitionStateV1.once(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
							timeoutInMs: 300_000,
						},
						expectedRevision: parentRecord.revision,
						expectedSignalSequence: 0,
					},
					{ revision: 1, state: workflowRunStateByStatus.awaiting_child_workflow, attempts: parentRecord.attempts }
				);

				await expect(childHandle.wait({ timeout: { minutes: 5 } })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
			}));

		test("ends the parent's execution when the parent changed before the wait was recorded", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
						},
						expectedRevision: parentRecord.revision,
						expectedSignalSequence: 0,
					},
					{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
				);

				await expect(childHandle.wait()).rejects.toBeInstanceOf(WorkflowRunRevisionConflictError);

				expect(() => parentHandle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunRevisionConflictError);
			}));

		test("ends the parent's execution when the wait request gets no response", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				client.api.workflowRun.transitionStateV1.rejectsOnce(
					{
						type: "optimistic",
						id: parentRecord.id,
						state: {
							status: "awaiting_child_workflow",
							childWorkflowRunId: childRecord.id,
						},
						expectedRevision: parentRecord.revision,
						expectedSignalSequence: 0,
					},
					new Error("fetch failed")
				);

				await expect(childHandle.wait()).rejects.toBeInstanceOf(WorkflowRunStateUnknownError);

				expect(() => parentHandle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunStateUnknownError);
			}));

		test("refuses to wait once the parent's execution has ended", () =>
			withFakeClient(async (client) => {
				const childRecord = runningWorkflowRunRecordFactory.build();
				const parentRecord = runningWorkflowRunRecordFactory.build({
					childWorkflowRunWaits: { [childRecord.id]: { timeouts: [] } },
				});
				const parentHandle = workflowRunHandle(client, parentRecord);
				const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

				const suspension = new WorkflowRunSuspendedError(parentRecord.id as WorkflowRunId);
				await expect(parentHandle[INTERNAL].executeIfAllowed(() => Promise.reject(suspension))).rejects.toBe(
					suspension
				);

				await expect(childHandle.wait()).rejects.toBe(suspension);
			}));
	});

	test("exposes the child run", () =>
		withFakeClient((client) => {
			const childRecord = runningWorkflowRunRecordFactory.build();
			const parentHandle = workflowRunHandle(client, runningWorkflowRunRecordFactory.build());
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

			expect(childHandle.run).toEqual(childRecord);
		}));

	test("exposes the refetched child run after a refresh", () =>
		withFakeClient(async (client) => {
			const childRecord = runningWorkflowRunRecordFactory.build();
			const parentHandle = workflowRunHandle(client, runningWorkflowRunRecordFactory.build());
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

			const refreshedChildRecord: WorkflowRunRecord = {
				...baseWorkflowRunRecordFactory.build({ id: childRecord.id }),
				state: { status: "completed", output: asOpaquePayload("done") },
			};
			client.api.workflowRun.getByIdV1.once({ id: childRecord.id }, { run: refreshedChildRecord });

			await childHandle.refresh();

			expect(childHandle.run).toEqual(refreshedChildRecord);
		}));

	test("cancels the child run, not the parent", () =>
		withFakeClient(async (client) => {
			const childRecord = runningWorkflowRunRecordFactory.build({ revision: 2 });
			const parentHandle = workflowRunHandle(client, runningWorkflowRunRecordFactory.build());
			const childHandle = childWorkflowRunHandle(client, childRecord, parentHandle, client.logger);

			client.api.workflowRun.transitionStateV1.once(
				{ type: "pessimistic", id: childRecord.id, state: { status: "cancelled", explanation: "stop it" } },
				{ revision: 3, state: { status: "cancelled" }, attempts: childRecord.attempts }
			);

			await childHandle.cancel("stop it");
		}));
});
