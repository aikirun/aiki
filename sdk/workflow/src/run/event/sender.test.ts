import { withFakeClient } from "@aikirun/testing/client";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { SchemaValidationError } from "@aikirun/types/validator";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";

import { event } from "./definition";
import { createEventSenders } from "./sender";

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

describe("createEventSenders", () => {
	test("sends the event data to the run", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client,
				"run-1",
				{ orderShipped: event<{ trackingId: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "orderShipped",
				data: asOpaquePayload({ trackingId: "T1" }),
				clientCodecApplied: false,
				options: {},
			});

			await senders.orderShipped.send({ trackingId: "T1" });
		}));

	test("sends the schema-parsed value", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(client, "run-1", { note: event({ schema: appendBangSchema }) }, client.logger);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "note",
				data: asOpaquePayload("raw!"),
				clientCodecApplied: false,
				options: {},
			});

			await senders.note.send("raw");
		}));

	test("throws SchemaValidationError and sends nothing when the data fails the schema", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client,
				"run-1",
				{ note: event({ schema: alwaysInvalidSchema }) },
				client.logger
			);

			await expect(senders.note.send("bad")).rejects.toBeInstanceOf(SchemaValidationError);
		}));

	test("threads builder options into the send", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client,
				"run-1",
				{ orderShipped: event<{ trackingId: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "orderShipped",
				data: asOpaquePayload({ trackingId: "T1" }),
				clientCodecApplied: false,
				options: { reference: { id: "ref-1" } },
			});

			await senders.orderShipped.with("reference.id", "ref-1").send({ trackingId: "T1" });
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
			const senders = createEventSenders(
				client,
				"run-1",
				{ orderShipped: event<{ trackingId: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "orderShipped",
				data: encodedData,
				clientCodecApplied: true,
				options: {},
			});

			await senders.orderShipped.send({ trackingId: "T1" });
		}));

	test("sends the event data as JSON, turning a date into its ISO string", () =>
		withFakeClient(async (client) => {
			const senders = createEventSenders(
				client,
				"run-1",
				{ orderShipped: event<{ shippedAt: string }>() },
				client.logger
			);
			client.api.workflowRun.sendEventV1.once({
				id: "run-1",
				eventName: "orderShipped",
				data: asOpaquePayload({ shippedAt: "1970-01-01T00:00:00.000Z" }),
				clientCodecApplied: false,
				options: {},
			});

			// The type says string but it really is a date
			await senders.orderShipped.send({ shippedAt: new Date(0) as unknown as string });
		}));
});
