import { withFakeClient } from "@aikirun/testing/client";
import { runningWorkflowRunRecordFactory } from "@aikirun/testing/data-factory/workflow/run";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { ClientCodecMissingError } from "@aikirun/types/workflow/run";

import { bindRunCodec, noopCodec, toBoundCodec } from "./bound-codec";
import { describe, expect, test } from "bun:test";

describe("toBoundCodec", () => {
	test("delegates encode and decode to the codec", async () => {
		const bound = toBoundCodec({
			encode: async (payload) => ({ marked: payload }),
			decode: async (payload) => ({ unmarked: payload }),
		});
		const payload = { value: 1 };

		expect(await bound.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
		expect(await bound.decode(asOpaquePayload(payload))).toEqual({ unmarked: payload });
	});
});

describe("noopCodec", () => {
	test("passes payloads through unchanged", async () => {
		const payload = { value: 1 };

		expect(await noopCodec.encode(payload)).toBe(asOpaquePayload(payload));
		expect(await noopCodec.decode(asOpaquePayload(payload))).toBe(payload);
	});
});

describe("bindRunCodec", () => {
	test("binds the client's codec for a run that expects it", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => ({ marked: payload }),
				decode: async (payload) => ({ unmarked: payload }),
			};
			const record = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });

			const codec = bindRunCodec(client, record);

			const payload = { value: 1 };
			expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
			expect(await codec.decode(asOpaquePayload(payload))).toEqual({ unmarked: payload });
		}));

	test("binds a passthrough codec for a run that doesn't expect a client codec", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => ({ marked: payload }),
				decode: async (payload) => ({ unmarked: payload }),
			};
			const record = runningWorkflowRunRecordFactory.build({ clientCodecApplied: false });

			const codec = bindRunCodec(client, record);

			const payload = { value: 1 };
			expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
			expect(await codec.decode(asOpaquePayload(payload))).toBe(payload);
		}));

	test("throws ClientCodecMissingError for a run that expects a client codec when the client has none", () =>
		withFakeClient((client) => {
			const record = runningWorkflowRunRecordFactory.build({ clientCodecApplied: true });

			expect(() => bindRunCodec(client, record)).toThrow(ClientCodecMissingError);
		}));
});
