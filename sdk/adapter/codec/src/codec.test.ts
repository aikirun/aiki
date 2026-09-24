import { noopLogger } from "@aikirun/lib/logger";

import { CodecNameMismatchError, codec, InvalidCodecPayloadFormatError } from "./codec";
import { describe, expect, test } from "bun:test";

describe("codec", () => {
	const created = codec({
		name: "test-codec",
		encode: (payload) => ({ wrapped: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("wrapped" in body)) {
				throw new Error("unexpected body");
			}
			return body.wrapped;
		},
	});
	const instance = created({ logger: noopLogger });

	test("encode wraps the body with the codec name", async () => {
		const payload = { name: "alice" };
		expect(await instance.encode(payload)).toEqual({
			codecName: "test-codec",
			body: { wrapped: payload },
		});
	});

	test("decode unwraps a matching envelope", async () => {
		const payload = { name: "alice" };
		expect(
			await instance.decode({
				codecName: "test-codec",
				body: { wrapped: payload },
			})
		).toEqual(payload);
	});

	test("decode rejects a payload without the envelope", async () => {
		expect(instance.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidCodecPayloadFormatError(test-codec)",
			codecName: "test-codec",
			message: 'Codec "test-codec" payload is missing the { codecName, body } envelope',
		});
		expect(instance.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidCodecPayloadFormatError);
	});

	test("decode rejects a mismatched codec name", async () => {
		expect(
			instance.decode({
				codecName: "other-codec",
				body: { wrapped: { name: "alice" } },
			})
		).rejects.toMatchObject({
			name: "CodecNameMismatchError(test-codec)",
			codecName: "test-codec",
			payloadName: "other-codec",
			message: 'Codec name mismatch: expected "test-codec", got "other-codec"',
		});
		expect(
			instance.decode({
				codecName: "other-codec",
				body: { wrapped: { name: "alice" } },
			})
		).rejects.toBeInstanceOf(CodecNameMismatchError);
	});

	test("awaits async encode and decode", async () => {
		const asyncCodec = codec({
			name: "async-codec",
			encode: async (payload) => `enc:${JSON.stringify(payload)}`,
			decode: async (body) => JSON.parse(String(body).slice("enc:".length)),
		})({ logger: noopLogger });

		const payload = { name: "bob" };
		const encoded = await asyncCodec.encode(payload);
		expect(encoded).toEqual({
			codecName: "async-codec",
			body: `enc:${JSON.stringify(payload)}`,
		});
		expect(await asyncCodec.decode(encoded)).toEqual(payload);
	});
});
