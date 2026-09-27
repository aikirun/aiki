import { noopLogger } from "@aikirun/lib/logger";

import { CodecNameMismatchError, codec, InvalidEncodedValueError } from "./codec";
import { describe, expect, test } from "bun:test";

describe("codec", () => {
	const created = codec({
		name: "test-codec",
		encode: (payload) => ({ wrapped: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.wrapped),
	});
	const instance = created({ logger: noopLogger });

	test("encode wraps the body with the codec name", async () => {
		const payload = { name: "alice" };
		expect(await instance.encode(payload)).toEqual({
			codecName: "test-codec",
			body: { wrapped: JSON.stringify(payload) },
		});
	});

	test("decode recovers the payload from a value it encoded", async () => {
		const payload = { name: "alice" };
		expect(
			await instance.decode({
				codecName: "test-codec",
				body: { wrapped: JSON.stringify(payload) },
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
				body: { wrapped: JSON.stringify({ name: "alice" }) },
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
				body: { wrapped: JSON.stringify({ name: "alice" }) },
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

describe("codec output must survive a JSON round trip", () => {
	test("accepts a string", () => {
		codec({ name: "json", encode: (payload) => JSON.stringify(payload), decode: (encoded) => JSON.parse(encoded) });
	});

	test("accepts a reference to offloaded data", () => {
		codec({ name: "offload", encode: async () => ({ ref: "bucket/key" }), decode: async (encoded) => encoded.ref });
	});

	test("accepts the payload embedded as a string", () => {
		codec({
			name: "tag",
			encode: (payload) => ({ tagged: JSON.stringify(payload) }),
			decode: (encoded) => JSON.parse(encoded.tagged),
		});
	});

	test("rejects the payload embedded as-is, since its type is unknown", () => {
		// @ts-expect-error encoded.tagged is unknown
		codec({ name: "tag", encode: (payload) => ({ tagged: payload }), decode: (encoded) => encoded.tagged });
	});

	test("rejects raw bytes", () => {
		// @ts-expect-error encoded is binary data
		codec({ name: "gzip", encode: () => new Uint8Array(4), decode: (encoded) => encoded });
	});

	test("rejects bytes nested in the output", () => {
		// @ts-expect-error encoded.iv is binary data
		codec({ name: "aes", encode: () => ({ iv: new Uint8Array(12), ct: "…" }), decode: (encoded) => encoded.ct });
	});

	test("rejects a Date nested in the output", () => {
		// @ts-expect-error encoded.writtenAt is Date
		codec({ name: "stamp", encode: () => ({ writtenAt: new Date(), body: "…" }), decode: (encoded) => encoded.body });
	});

	test("rejects an output typed any", () => {
		// @ts-expect-error encoded is any
		codec({ name: "loose", encode: (payload) => JSON.parse(JSON.stringify(payload)), decode: (encoded) => encoded });
	});
});
