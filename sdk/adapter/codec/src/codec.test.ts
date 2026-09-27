import { noopLogger } from "@aikirun/lib/logger";

import { CodecNameMismatchError, codec, InvalidEncodedValueError } from "./codec";
import { describe, expect, test } from "bun:test";

describe("codec", () => {
	const created = codec({
		name: "test-codec",
		encode: (payload) => ({ wrapped: payload }),
		decode: (encoded) => {
			if (typeof encoded !== "object" || encoded === null || !("wrapped" in encoded)) {
				throw new Error("unexpected encoded value");
			}
			return encoded.wrapped;
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

	test("decode recovers the payload from a value it encoded", async () => {
		const payload = { name: "alice" };
		expect(
			await instance.decode({
				codecName: "test-codec",
				body: { wrapped: payload },
			})
		).toEqual(payload);
	});

	test("decode rejects a value that was not encoded", async () => {
		expect(instance.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidEncodedValueError",
			codecName: "test-codec",
			message: 'Codec "test-codec" received a value that was not produced by encode',
		});
		expect(instance.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidEncodedValueError);
	});

	test("decode rejects a mismatched codec name", async () => {
		expect(
			instance.decode({
				codecName: "other-codec",
				body: { wrapped: { name: "alice" } },
			})
		).rejects.toMatchObject({
			name: "CodecNameMismatchError",
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
			decode: async (encoded) => JSON.parse(String(encoded).slice("enc:".length)),
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
