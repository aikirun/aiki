import { noopLogger } from "@aikirun/lib/logger";
import { withFakeClient } from "@aikirun/testing/client";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	ClientCodecMissingError,
	CodecDecodeFailedError,
	CodecEncodeFailedError,
	type WorkflowRunId,
} from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import {
	bindDeclaredCodec,
	bindDefinitionCodec,
	composeCodecs,
	noopCodec,
	resolveClientCodec,
	resolveWorkflowInputCodec,
	toBoundCodec,
} from "./bound-codec";

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

	test("rejects with CodecEncodeFailedError, caused by the codec's error, when the codec cannot encode", async () => {
		const codecError = new Error("Key 2025-06 not found");
		const bound = toBoundCodec({
			encode: async () => {
				throw codecError;
			},
			decode: async (payload) => payload,
		});

		const encoding = bound.encode({ value: 1 });
		await expect(encoding).rejects.toThrow(CodecEncodeFailedError);
		await expect(encoding).rejects.toMatchObject({ cause: codecError });
	});

	test("rejects with CodecDecodeFailedError, caused by the codec's error, when the codec cannot decode", async () => {
		const codecError = new Error("No codec named aes-v1");
		const bound = toBoundCodec({
			encode: async (payload) => payload,
			decode: async () => {
				throw codecError;
			},
		});

		const decoding = bound.decode(asOpaquePayload("aes-v1:charged"));
		await expect(decoding).rejects.toThrow(CodecDecodeFailedError);
		await expect(decoding).rejects.toMatchObject({ cause: codecError });
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

describe("composeCodecs", () => {
	const inner = toBoundCodec({
		encode: async (payload) => ({ inner: payload }),
		decode: async (payload) => {
			const { inner: body } = payload as { inner: unknown };
			return body;
		},
	});
	const outer = toBoundCodec({
		encode: async (payload) => ({ outer: payload }),
		decode: async (payload) => {
			const { outer: body } = payload as { outer: unknown };
			return body;
		},
	});

	test("encodes through inner then outer, and decodes in reverse", async () => {
		const composed = composeCodecs(inner, outer);
		const payload = { value: 1 };

		const encoded = await composed.encode(payload);
		expect(encoded).toEqual(asOpaquePayload({ outer: { inner: payload } }));
		expect(await composed.decode(encoded)).toEqual(payload);
	});

	test("is a no-op when both layers are noop", async () => {
		const composed = composeCodecs(noopCodec, noopCodec);
		const payload = { value: 1 };

		expect(await composed.encode(payload)).toBe(asOpaquePayload(payload));
		expect(await composed.decode(asOpaquePayload(payload))).toBe(payload);
	});
});

describe("bindDefinitionCodec", () => {
	test("binds the codec", async () => {
		const codec = bindDefinitionCodec({
			encode: async (payload) => ({ marked: payload }),
			decode: async (payload) => {
				const { marked } = payload as { marked: unknown };
				return marked;
			},
		});
		const payload = { value: 1 };
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ marked: payload }));
		expect(await codec.decode(asOpaquePayload({ marked: payload }))).toEqual(payload);
	});

	test("returns the noop when no codec is set", async () => {
		const codec = bindDefinitionCodec(undefined);
		const payload = { value: 1 };

		expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
		expect(await codec.decode(asOpaquePayload(payload))).toBe(payload);
	});
});

describe("resolveWorkflowInputCodec", () => {
	const definition = {
		input: () => ({
			encode: async (payload: unknown) => ({ def: payload }),
			decode: async (payload: unknown) => {
				const { def } = payload as { def: unknown };
				return def;
			},
		}),
	};
	const clientCodec = {
		encode: async (payload: unknown) => ({ client: payload }),
		decode: async (payload: unknown) => {
			const { client } = payload as { client: unknown };
			return client;
		},
	};

	test("composes definition inside client when both are present", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definition,
			clientCodec,
			policy: undefined,
			logger: noopLogger,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ client: { def: payload } }));
		expect(await codec.decode(asOpaquePayload({ client: { def: payload } }))).toEqual(payload);
	});

	test("applies only the definition when the client codec is skipped", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definition,
			clientCodec,
			policy: "skip",
			logger: noopLogger,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(false);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ def: payload }));
		expect(await codec.decode(asOpaquePayload({ def: payload }))).toEqual(payload);
	});

	test("applies only the client when no definition codec is set", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definition: undefined,
			clientCodec,
			policy: "apply",
			logger: noopLogger,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ client: payload }));
	});

	test("is a no-op when neither layer is present", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definition: undefined,
			clientCodec: undefined,
			policy: undefined,
			logger: noopLogger,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(false);
		expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
	});
});
