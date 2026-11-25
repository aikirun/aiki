import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory, workflowRunStateByStatus } from "@aikirun/testing/data-factory/workflow/run";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";
import {
	ClientCodecMissingError,
	WorkflowRunRevisionConflictError,
	WorkflowRunStateUnknownError,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";

import { event } from "./definition";
import { createEventWaiters } from "./waiter";
import { workflowRunHandle } from "../handle/workflow-run";

const appendBangSchema: StandardSchemaV1<string> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) => ({ value: `${String(value)}!` }),
	},
};

describe("createEventWaiters", () => {
	test("returns the recorded data when the event was received", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaits: {
					orderShipped: [
						{
							status: "received",
							data: asOpaquePayload({ trackingId: "T1" }),
							clientCodecApplied: false,
							receivedAt: 0,
						},
					],
				},
			});
			const definition = { orderShipped: event<{ trackingId: string }>() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toEqual({ trackingId: "T1" });
		}));

	test("returns the time the event was received alongside its data", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaits: {
					orderShipped: [
						{
							status: "received",
							data: asOpaquePayload({ trackingId: "T1" }),
							clientCodecApplied: false,
							receivedAt: 1_700_000_000_000,
						},
					],
				},
			});
			const definition = { orderShipped: event<{ trackingId: string }>() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(await waiters.orderShipped.wait({ timeout: { seconds: 1 } })).toEqual({
				timeout: false,
				data: { trackingId: "T1" },
				receivedAt: 1_700_000_000_000,
			});
		}));

	test("returns a timeout with the time the wait expired", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaits: { orderShipped: [{ status: "timeout", timedOutAt: 1_700_000_060_000 }] },
			});
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(await waiters.orderShipped.wait({ timeout: { seconds: 1 } })).toEqual({
				timeout: true,
				timedOutAt: 1_700_000_060_000,
			});
		}));

	test("returns recorded data as-is, without applying the event schema", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaits: {
					orderShipped: [
						{ status: "received", data: asOpaquePayload("raw"), clientCodecApplied: false, receivedAt: 0 },
					],
				},
			});
			const definition = { orderShipped: event({ schema: appendBangSchema }) };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toBe("raw");
		}));

	test("decodes the recorded data by the sender's declaration, not the run's", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => payload,
				decode: async (payload) => ({ unmarked: payload }),
			};
			const record = runningWorkflowRunRecordFactory.build({
				clientCodecApplied: false,
				eventWaits: {
					orderShipped: [
						{ status: "received", data: asOpaquePayload("marked"), clientCodecApplied: true, receivedAt: 0 },
					],
				},
			});
			const definition = { orderShipped: event<{ unmarked: string }>() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toEqual({ unmarked: "marked" });
		}));

	test("returns the recorded data as-is when the sender declared no client codec, even on a run that applied it", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => payload,
				decode: async (payload) => ({ unmarked: payload }),
			};
			const record = runningWorkflowRunRecordFactory.build({
				clientCodecApplied: true,
				eventWaits: {
					orderShipped: [
						{ status: "received", data: asOpaquePayload("raw"), clientCodecApplied: false, receivedAt: 0 },
					],
				},
			});
			const definition = { orderShipped: event<string>() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toBe("raw");
		}));

	test("throws ClientCodecMissingError when the recorded data expects a client codec the client lacks", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				clientCodecApplied: false,
				eventWaits: {
					orderShipped: [
						{ status: "received", data: asOpaquePayload("marked"), clientCodecApplied: true, receivedAt: 0 },
					],
				},
			});
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			await expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(ClientCodecMissingError);
		}));

	test("transitions to awaiting_event and suspends when no wait is recorded", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });
			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped" },
					expectedRevision: 0,
					expectedSignalSequence: 0,
				},
				{ revision: 1, state: workflowRunStateByStatus.awaiting_event, attempts: record.attempts }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			await expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
		}));

	test("carries the timeout into the awaiting_event transition", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });
			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped", timeoutInMs: 30_000 },
					expectedRevision: 0,
					expectedSignalSequence: 0,
				},
				{ revision: 1, state: workflowRunStateByStatus.awaiting_event, attempts: record.attempts }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			await expect(waiters.orderShipped.wait({ timeout: { seconds: 30 } })).rejects.toBeInstanceOf(
				WorkflowRunSuspendedError
			);
		}));

	test("ends the execution when the run changed before the wait was recorded", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });
			client.api.workflowRun.transitionStateV1.rejectsOnce(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped" },
					expectedRevision: 0,
					expectedSignalSequence: 0,
				},
				{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			await expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunRevisionConflictError);

			expect(() => handle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunRevisionConflictError);
		}));

	test("advances the cursor across calls, consuming recorded waits in order", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaits: {
					orderShipped: [
						{ status: "received", data: asOpaquePayload("first"), clientCodecApplied: false, receivedAt: 0 },
						{ status: "received", data: asOpaquePayload("second"), clientCodecApplied: false, receivedAt: 0 },
					],
				},
			});
			const definition = { orderShipped: event<string>() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toBe("first");
			expect((await waiters.orderShipped.wait()).data).toBe("second");
		}));

	test("ends the execution when the wait request gets no response", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });
			client.api.workflowRun.transitionStateV1.rejectsOnce(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped" },
					expectedRevision: 0,
					expectedSignalSequence: 0,
				},
				new Error("fetch failed")
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			await expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunStateUnknownError);

			expect(() => handle[INTERNAL].assertExecutionAllowed()).toThrow(WorkflowRunStateUnknownError);
		}));

	test("refuses to wait once the execution has ended", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build();
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, { eventsDefinition: definition });
			const waiters = createEventWaiters(handle, definition, client.logger);

			const suspension = new WorkflowRunSuspendedError(record.id as WorkflowRunId);
			await expect(handle[INTERNAL].executeIfAllowed(() => Promise.reject(suspension))).rejects.toBe(suspension);

			await expect(waiters.orderShipped.wait()).rejects.toBe(suspension);
		}));
});
