import { withFakeClient } from "@aikirun/testing/client";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import { ClientCodecMissingError, type WorkflowRunId } from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import { bindDeclaredCodec, noopCodec, resolveClientCodec, resolveParentCodec, toBoundCodec } from "./bound-codec";

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

describe("resolveClientCodec", () => {
	const clientCodec = {
		encode: async (payload: unknown) => ({ marked: payload }),
		decode: async (payload: unknown) => ({ unmarked: payload }),
	};

	test("applies the client codec when the policy is unset", async () => {
		const { codec, applied } = resolveClientCodec(clientCodec, undefined);
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
	});

	test("applies the client codec when the policy is apply", async () => {
		const { codec, applied } = resolveClientCodec(clientCodec, "apply");
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
	});

	test("skips the client codec when the policy is skip", async () => {
		const { codec, applied } = resolveClientCodec(clientCodec, "skip");
		const payload = { value: 1 };

		expect(applied).toBe(false);
		expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
	});

	test("skips when the client has no codec, whatever the policy", async () => {
		expect(resolveClientCodec(undefined, "apply")).toEqual({ codec: noopCodec, applied: false });
		expect(resolveClientCodec(undefined, "skip")).toEqual({ codec: noopCodec, applied: false });
		expect(resolveClientCodec(undefined, undefined)).toEqual({ codec: noopCodec, applied: false });
	});
});

describe("resolveParentCodec", () => {
	const parentCodec = toBoundCodec({
		encode: async (payload: unknown) => ({ marked: payload }),
		decode: async (payload: unknown) => ({ unmarked: payload }),
	});
	const clientCodec = {
		encode: async (payload: unknown) => ({ clientMarked: payload }),
		decode: async (payload: unknown) => ({ clientUnmarked: payload }),
	};

	test("uses the parent's codec when the parent applied it and the policy is unset", async () => {
		const { codec, applied } = resolveParentCodec(parentCodec, true, undefined, clientCodec);
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
	});

	test("uses the parent's codec when the policy is apply and the parent applied it", async () => {
		const { codec, applied } = resolveParentCodec(parentCodec, true, "apply", clientCodec);
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
	});

	test("falls back to the client codec when the policy is apply and the parent did not apply", async () => {
		const { codec, applied } = resolveParentCodec(noopCodec, false, "apply", clientCodec);
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ clientMarked: payload }));
	});

	test("falls back to the client codec when the policy is unset and the parent did not apply", async () => {
		const { codec, applied } = resolveParentCodec(noopCodec, false, undefined, clientCodec);
		const payload = { value: 1 };

		expect(applied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ clientMarked: payload }));
	});

	test("skips even when the parent applied the codec", async () => {
		const { codec, applied } = resolveParentCodec(parentCodec, true, "skip", clientCodec);
		const payload = { value: 1 };

		expect(applied).toBe(false);
		expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
	});
});

describe("bindDeclaredCodec", () => {
	const runId = "run-1" as WorkflowRunId;

	test("binds the client's codec when the declaration says it was applied", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => ({ marked: payload }),
				decode: async (payload) => ({ unmarked: payload }),
			};

			const codec = bindDeclaredCodec(client, { runId, clientCodecApplied: true });

			const payload = { value: 1 };
			expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
			expect(await codec.decode(asOpaquePayload(payload))).toEqual({ unmarked: payload });
		}));

	test("binds a passthrough codec when the declaration says it was not applied", () =>
		withFakeClient(async (client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => ({ marked: payload }),
				decode: async (payload) => ({ unmarked: payload }),
			};

			const codec = bindDeclaredCodec(client, { runId, clientCodecApplied: false });

			const payload = { value: 1 };
			expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
			expect(await codec.decode(asOpaquePayload(payload))).toBe(payload);
		}));

	test("throws ClientCodecMissingError when the declaration expects a client codec the client lacks", () =>
		withFakeClient((client) => {
			expect(() => bindDeclaredCodec(client, { runId, clientCodecApplied: true })).toThrow(ClientCodecMissingError);
		}));
});
