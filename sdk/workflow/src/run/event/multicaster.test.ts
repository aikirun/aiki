import { withFakeClient } from "@aikirun/testing/client";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";

import { event } from "./definition";
import { createEventMulticasters } from "./multicaster";

const alwaysInvalidSchema: StandardSchemaV1<string> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: () => ({ issues: [{ message: "invalid event data" }] }),
	},
};

describe("createEventMulticasters", () => {
	const workflowName = "order-workflow" as WorkflowName;
	const versionId = "1.0.0" as WorkflowVersionId;

	test("multicasts the event to the given run ids", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1", "run-2"],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1", "run-2"], failedIds: [] }
			);

			expect(await multicasters.orderShipped.send(client, ["run-1", "run-2"], { trackingId: "T1" })).toEqual({
				sentIds: ["run-1", "run-2"],
				failedIds: [],
			});
		}));

	test("wraps a single run id in an array", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1"],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			await multicasters.orderShipped.send(client, "run-1", { trackingId: "T1" });
		}));

	test("sends nothing when the run id list is empty", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});

			expect(await multicasters.orderShipped.send(client, [], { trackingId: "T1" })).toEqual({
				sentIds: [],
				failedIds: [],
			});
		}));

	test("multicasts by reference id, tagging each with the workflow name and version", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once(
				{
					references: [
						{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" },
						{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-2" },
					],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1", "run-2"], failedIds: [] }
			);

			expect(
				await multicasters.orderShipped.sendByReferenceId(client, ["ref-1", "ref-2"], { trackingId: "T1" })
			).toEqual({ sentIds: ["run-1", "run-2"], failedIds: [] });
		}));

	test("wraps a single reference id in an array", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once(
				{
					references: [{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" }],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			await multicasters.orderShipped.sendByReferenceId(client, "ref-1", { trackingId: "T1" });
		}));

	test("sends nothing when the reference id list is empty", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});

			expect(await multicasters.orderShipped.sendByReferenceId(client, [], { trackingId: "T1" })).toEqual({
				sentIds: [],
				failedIds: [],
			});
		}));

	test("reports the runs the server could not reach alongside the ones it did", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1", "run-2", "run-3"],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1", "run-3"], failedIds: ["run-2"] }
			);

			expect(await multicasters.orderShipped.send(client, ["run-1", "run-2", "run-3"], { trackingId: "T1" })).toEqual({
				sentIds: ["run-1", "run-3"],
				failedIds: ["run-2"],
			});
		}));

	test("throws SchemaValidationError and sends nothing when the data fails the schema", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				note: event({ schema: alwaysInvalidSchema }),
			});

			await expect(multicasters.note.send(client, "run-1", "bad")).rejects.toBeInstanceOf(SchemaValidationError);
		}));

	test("threads builder options into the multicast", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1"],
					eventName: "orderShipped",
					data: asOpaquePayload({ trackingId: "T1" }),
					clientCodecApplied: false,
					options: { reference: { id: "ref-1" } },
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			await multicasters.orderShipped.with("reference.id", "ref-1").send(client, "run-1", { trackingId: "T1" });
		}));

	test("encodes the data with the client's codec and declares it applied", () =>
		withFakeClient(async (client) => {
			const encodedData = asOpaquePayload({ encoded: true });
			client[INTERNAL].codec = {
				encode: async (payload) => {
					expect(payload).toEqual({ trackingId: "T1" });
					return encodedData;
				},
				decode: async (payload) => payload,
			};
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1"],
					eventName: "orderShipped",
					data: encodedData,
					clientCodecApplied: true,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			await multicasters.orderShipped.send(client, "run-1", { trackingId: "T1" });
		}));

	test("encodes the data with the client's codec and declares it applied when multicasting by reference", () =>
		withFakeClient(async (client) => {
			const encodedData = asOpaquePayload({ encoded: true });
			client[INTERNAL].codec = {
				encode: async (payload) => {
					expect(payload).toEqual({ trackingId: "T1" });
					return encodedData;
				},
				decode: async (payload) => payload,
			};
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ trackingId: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once(
				{
					references: [{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" }],
					eventName: "orderShipped",
					data: encodedData,
					clientCodecApplied: true,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			await multicasters.orderShipped.sendByReferenceId(client, "ref-1", { trackingId: "T1" });
		}));

	test("multicasts the event data as JSON, turning a date into its ISO string", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ shippedAt: string }>(),
			});
			client.api.workflowRun.multicastEventV1.once(
				{
					ids: ["run-1"],
					eventName: "orderShipped",
					data: asOpaquePayload({ shippedAt: "1970-01-01T00:00:00.000Z" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			// The type says string but it really is a date
			await multicasters.orderShipped.send(client, "run-1", { shippedAt: new Date(0) as unknown as string });
		}));

	test("multicasts the event data by reference as JSON, turning a date into its ISO string", () =>
		withFakeClient(async (client) => {
			const multicasters = createEventMulticasters(workflowName, versionId, {
				orderShipped: event<{ shippedAt: string }>(),
			});
			client.api.workflowRun.multicastEventByReferenceV1.once(
				{
					references: [{ name: "order-workflow", versionId: "1.0.0", referenceId: "ref-1" }],
					eventName: "orderShipped",
					data: asOpaquePayload({ shippedAt: "1970-01-01T00:00:00.000Z" }),
					clientCodecApplied: false,
					options: {},
				},
				{ sentIds: ["run-1"], failedIds: [] }
			);

			// The type says string but it really is a date
			await multicasters.orderShipped.sendByReferenceId(client, "ref-1", {
				shippedAt: new Date(0) as unknown as string,
			});
		}));
});
