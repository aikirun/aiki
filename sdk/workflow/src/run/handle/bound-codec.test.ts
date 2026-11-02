import { noopLogger } from "@aikirun/lib/logger";
import { withFakeClient } from "@aikirun/testing/client";
import { asOpaquePayload } from "@aikirun/testing/payload";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	ClientCodecMissingError,
	CodecDecodeFailedError,
	CodecEncodeFailedError,
	CodecInitFailedError,
	type WorkflowRunId,
} from "@aikirun/types/workflow/run";
import { describe, expect, test } from "vitest";

import {
	bindDeclaredCodec,
	composeCodecs,
	instantiateCodec,
	instantiateWorkflowDefinitionCodec,
	noopCodec,
	resolveDeclaredClientCodec,
	resolveWorkflowInputCodec,
	toBoundCodec,
} from "./bound-codec";

describe("instantiateCodec", () => {
	test("throws CodecInitFailedError, caused by the factory's error, when the factory throws", () => {
		const codecError = new Error("No keyring available");
		let thrown: unknown;
		try {
			instantiateCodec(
				() => {
					throw codecError;
				},
				noopLogger,
				"workflow",
				"input"
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(CodecInitFailedError);
		expect(thrown).toMatchObject({ cause: codecError, level: "workflow", role: "input" });
	});

	test("returns undefined when no factory is provided", () => {
		expect(instantiateCodec(undefined, noopLogger, "workflow", "input")).toBeUndefined();
	});
});

describe("instantiateWorkflowDefinitionCodec", () => {
	test("throws CodecInitFailedError, caused by the factory's error, when the input factory throws", () => {
		const codecError = new Error("No keyring available");
		let thrown: unknown;
		try {
			instantiateWorkflowDefinitionCodec(
				{
					input: () => {
						throw codecError;
					},
				},
				noopLogger
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(CodecInitFailedError);
		expect(thrown).toMatchObject({ cause: codecError, level: "workflow", role: "input" });
	});

	test("throws CodecInitFailedError, caused by the factory's error, when the output factory throws", () => {
		const codecError = new Error("No keyring available");
		let thrown: unknown;
		try {
			instantiateWorkflowDefinitionCodec(
				{
					output: () => {
						throw codecError;
					},
				},
				noopLogger
			);
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(CodecInitFailedError);
		expect(thrown).toMatchObject({ cause: codecError, level: "workflow", role: "output" });
	});
});

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

describe("resolveDeclaredClientCodec", () => {
	const runId = "run-1" as WorkflowRunId;

	test("returns the client's codec when the declaration says it was applied", () =>
		withFakeClient((client) => {
			const codec = {
				encode: async (payload: unknown) => ({ marked: payload }),
				decode: async (payload: unknown) => ({ unmarked: payload }),
			};
			client[INTERNAL].codec = codec;

			expect(resolveDeclaredClientCodec(client, { runId, clientCodecApplied: true })).toBe(codec);
		}));

	test("returns undefined when the declaration says it was not applied", () =>
		withFakeClient((client) => {
			client[INTERNAL].codec = {
				encode: async (payload) => ({ marked: payload }),
				decode: async (payload) => ({ unmarked: payload }),
			};

			expect(resolveDeclaredClientCodec(client, { runId, clientCodecApplied: false })).toBeUndefined();
		}));

	test("throws ClientCodecMissingError when the declaration expects a client codec the client lacks", () =>
		withFakeClient((client) => {
			expect(() => resolveDeclaredClientCodec(client, { runId, clientCodecApplied: true })).toThrow(
				ClientCodecMissingError
			);
		}));
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
	const inner = {
		encode: async (payload: unknown) => ({ inner: payload }),
		decode: async (payload: unknown) => {
			const { inner: body } = payload as { inner: unknown };
			return body;
		},
	};
	const outer = {
		encode: async (payload: unknown) => ({ outer: payload }),
		decode: async (payload: unknown) => {
			const { outer: body } = payload as { outer: unknown };
			return body;
		},
	};

	test("encodes through inner then outer, and decodes in reverse", async () => {
		const composed = composeCodecs(inner, outer);
		const payload = { value: 1 };

		const encoded = await composed.encode(payload);
		expect(encoded).toEqual(asOpaquePayload({ outer: { inner: payload } }));
		expect(await composed.decode(encoded)).toEqual(payload);
	});

	test("binds only the inner when the outer is absent", async () => {
		const composed = composeCodecs(inner, undefined);
		const payload = { value: 1 };

		expect(await composed.encode(payload)).toEqual(asOpaquePayload({ inner: payload }));
		expect(await composed.decode(asOpaquePayload({ inner: payload }))).toEqual(payload);
	});

	test("binds only the outer when the inner is absent", async () => {
		const composed = composeCodecs(undefined, outer);
		const payload = { value: 1 };

		expect(await composed.encode(payload)).toEqual(asOpaquePayload({ outer: payload }));
		expect(await composed.decode(asOpaquePayload({ outer: payload }))).toEqual(payload);
	});

	test("is a no-op when both layers are absent", async () => {
		const composed = composeCodecs(undefined, undefined);
		const payload = { value: 1 };

		expect(await composed.encode(payload)).toBe(asOpaquePayload(payload));
		expect(await composed.decode(asOpaquePayload(payload))).toBe(payload);
	});
});

describe("resolveWorkflowInputCodec", () => {
	const definitionCodec = {
		encode: async (payload: unknown) => ({ def: payload }),
		decode: async (payload: unknown) => {
			const { def } = payload as { def: unknown };
			return def;
		},
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
			definitionCodec,
			clientCodec,
			policy: undefined,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ client: { def: payload } }));
		expect(await codec.decode(asOpaquePayload({ client: { def: payload } }))).toEqual(payload);
	});

	test("applies only the definition when the client codec is skipped", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definitionCodec,
			clientCodec,
			policy: "skip",
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(false);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ def: payload }));
		expect(await codec.decode(asOpaquePayload({ def: payload }))).toEqual(payload);
	});

	test("applies only the client when no definition codec is set", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definitionCodec: undefined,
			clientCodec,
			policy: "apply",
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(true);
		expect(await codec.encode(payload)).toEqual(asOpaquePayload({ client: payload }));
	});

	test("is a no-op when neither layer is present", async () => {
		const { codec, clientCodecApplied } = resolveWorkflowInputCodec({
			definitionCodec: undefined,
			clientCodec: undefined,
			policy: undefined,
		});
		const payload = { value: 1 };

		expect(clientCodecApplied).toBe(false);
		expect(await codec.encode(payload)).toBe(asOpaquePayload(payload));
	});
});
