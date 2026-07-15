import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory, workflowRunStateByStatus } from "@aikirun/testing/workflow/run";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import { WorkflowRunFailedError, WorkflowRunSuspendedError } from "@aikirun/types/workflow/run";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { createEventMulticasters, createEventSenders, createEventWaiters, event } from "./event";
import { workflowRunHandle } from "./handle";
import { describe, expect, test } from "bun:test";

const appendBangSchema: StandardSchemaV1<string> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) => ({ value: `${String(value)}!` }),
	},
};

const alwaysInvalidSchema: StandardSchemaV1<string> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: () => ({ issues: [{ message: "invalid event data" }] }),
	},
};

describe("event", () => {
	test("carries no schema by default", () => {
		expect(event().schema).toBeUndefined();
	});

	test("carries the provided schema", () => {
		expect(event({ schema: appendBangSchema }).schema).toBe(appendBangSchema);
	});
});

describe("createEventWaiters", () => {
	test("returns the recorded data when the event was received", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaitQueues: {
					orderShipped: { eventWaits: [{ status: "received", data: { trackingId: "T1" }, receivedAt: 0 }] },
				},
			});
			const definition = { orderShipped: event<{ trackingId: string }>() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toEqual({ trackingId: "T1" });
		}));

	test("returns a timeout when the recorded wait timed out", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaitQueues: { orderShipped: { eventWaits: [{ status: "timeout", timedOutAt: 0 }] } },
			});
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(await waiters.orderShipped.wait({ timeout: { seconds: 1 } })).toEqual({ timeout: true });
		}));

	test("returns the schema-parsed value when a schema is provided", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaitQueues: { orderShipped: { eventWaits: [{ status: "received", data: "raw", receivedAt: 0 }] } },
			});
			const definition = { orderShipped: event({ schema: appendBangSchema }) };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toBe("raw!");
		}));

	test("fails the run and throws WorkflowRunFailedError when the received data fails the schema", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build({
				revision: 0,
				eventWaitQueues: { orderShipped: { eventWaits: [{ status: "received", data: "bad", receivedAt: 0 }] } },
			});
			const definition = { orderShipped: event({ schema: alwaysInvalidSchema }) };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });
			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "failed", cause: "self", error: expect.objectContaining({ name: "SchemaValidationError" }) },
					expectedRevision: 0,
				},
				{ revision: 1, state: workflowRunStateByStatus.failed, attempts: record.attempts }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunFailedError);
		}));

	test("transitions to awaiting_event and suspends when no wait is recorded", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });
			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped" },
					expectedRevision: 0,
				},
				{ revision: 1, state: workflowRunStateByStatus.awaiting_event, attempts: record.attempts }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
		}));

	test("carries the timeout into the awaiting_event transition", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });
			client.api.workflowRun.transitionStateV1.once(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped", timeoutInMs: 30_000 },
					expectedRevision: 0,
				},
				{ revision: 1, state: workflowRunStateByStatus.awaiting_event, attempts: record.attempts }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(waiters.orderShipped.wait({ timeout: { seconds: 30 } })).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
		}));

	test("maps a revision conflict on the awaiting_event transition to a suspension", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build({ revision: 0 });
			const definition = { orderShipped: event() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1.once({ id: record.id }, { run: record });
			client.api.workflowRun.transitionStateV1.rejectsOnce(
				{
					type: "optimistic",
					id: record.id,
					state: { status: "awaiting_event", eventName: "orderShipped" },
					expectedRevision: 0,
				},
				{ code: "WORKFLOW_RUN_REVISION_CONFLICT" }
			);

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect(waiters.orderShipped.wait()).rejects.toBeInstanceOf(WorkflowRunSuspendedError);
		}));

	test("advances the cursor across calls, consuming recorded waits in order", () =>
		withFakeClient(async (client) => {
			const record = runningWorkflowRunRecordFactory.build({
				eventWaitQueues: {
					orderShipped: {
						eventWaits: [
							{ status: "received", data: "first", receivedAt: 0 },
							{ status: "received", data: "second", receivedAt: 0 },
						],
					},
				},
			});
			const definition = { orderShipped: event<string>() };
			const handle = workflowRunHandle(client, record, definition);
			client.api.workflowRun.getByIdV1
				.once({ id: record.id }, { run: record })
				.once({ id: record.id }, { run: record });

			const waiters = createEventWaiters(handle, definition, client.logger);

			expect((await waiters.orderShipped.wait()).data).toBe("first");
			expect((await waiters.orderShipped.wait()).data).toBe("second");
		}));
});

describe("createEventSenders", () => {
	test("sends the event data to the run", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client.api,
				"run-1",
				{ orderShipped: event<{ trackingId: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({ id: "run-1", eventName: "orderShipped", data: { trackingId: "T1" } });

			await senders.orderShipped.send({ trackingId: "T1" });
		}));

	test("sends the schema-parsed value", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client.api,
				"run-1",
				{ note: event({ schema: appendBangSchema }) },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({ id: "run-1", eventName: "note", data: "raw!" });

			await senders.note.send("raw");
		}));

	test("throws SchemaValidationError and sends nothing when the data fails the schema", () =>
		withFakeClient((client) => {
			const senders = createEventSenders(
				client.api,
				"run-1",
				{ note: event({ schema: alwaysInvalidSchema }) },
				client.logger
			);

			expect(senders.note.send("bad")).rejects.toBeInstanceOf(SchemaValidationError);
		}));

	test("threads builder options into the send", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client.api,
				"run-1",
				{ orderShipped: event<{ trackingId: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "orderShipped",
				data: { trackingId: "T1" },
				options: { reference: { id: "ref-1" } },
			});

			await senders.orderShipped.with().opt("reference.id", "ref-1").send({ trackingId: "T1" });
		}));
});

describe("createEventMulticasters", () => {
	const workflowName = "order-workflow" as WorkflowName;
	const versionId = "1.0.0" as WorkflowVersionId;

	test("multicasts the event to the given run ids", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once({
				ids: ["run-1", "run-2"],
				eventName: "orderShipped",
				data: { trackingId: "T1" },
			});

			await multicasters.orderShipped.send(client, ["run-1", "run-2"], { trackingId: "T1" });
		}));

	test("wraps a single run id in an array", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once({
				ids: ["run-1"],
				eventName: "orderShipped",
				data: { trackingId: "T1" },
			});

			await multicasters.orderShipped.send(client, "run-1", { trackingId: "T1" });
		}));

	test("sends nothing when the run id list is empty", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});

			expect(await multicasters.orderShipped.send(client, [], { trackingId: "T1" })).toBeUndefined();
		}));

	test("multicasts by reference id, tagging each with the workflow name and version", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once({
				references: [
					{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" },
					{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-2" },
				],
				eventName: "orderShipped",
				data: { trackingId: "T1" },
			});

			await multicasters.orderShipped.sendByReferenceId(client, ["ref-1", "ref-2"], { trackingId: "T1" });
		}));

	test("wraps a single reference id in an array", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once({
				references: [{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" }],
				eventName: "orderShipped",
				data: { trackingId: "T1" },
			});

			await multicasters.orderShipped.sendByReferenceId(client, "ref-1", { trackingId: "T1" });
		}));

	test("sends nothing when the reference id list is empty", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});

			expect(await multicasters.orderShipped.sendByReferenceId(client, [], { trackingId: "T1" })).toBeUndefined();
		}));

	test("throws SchemaValidationError and sends nothing when the data fails the schema", () =>
		withFakeClient((client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				note: event({ schema: alwaysInvalidSchema }),
			});

			expect(multicasters.note.send(client, "run-1", "bad")).rejects.toBeInstanceOf(SchemaValidationError);
		}));

	test("threads builder options into the multicast", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once({
				ids: ["run-1"],
				eventName: "orderShipped",
				data: { trackingId: "T1" },
				options: { reference: { id: "ref-1" } },
			});

			await multicasters.orderShipped.with().opt("reference.id", "ref-1").send(client, "run-1", { trackingId: "T1" });
		}));
});
