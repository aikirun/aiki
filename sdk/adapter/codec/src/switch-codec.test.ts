import { noopLogger } from "@aikirun/lib/logger";

import { codec, type EncodedValue, InvalidEncodedValueError, type NamedCreateCodec } from "./codec";
import { DuplicateCodecNameError, switchCodecs, UnknownCodecNameError } from "./switch-codec";
import { describe, expect, expectTypeOf, test } from "bun:test";

describe("switchCodecs", () => {
	const current = codec({
		name: "v2",
		encode: (payload) => ({ v2: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.v2),
	});
	const deprecated = codec({
		name: "v1",
		encode: (payload) => ({ v1: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.v1),
	});
	const switched = switchCodecs({ current, deprecated: [deprecated] })({ logger: noopLogger });

	test("encode uses the current member", async () => {
		const payload = { name: "alice" };
		expect(await switched.encode(payload)).toEqual({
			codecName: "v2",
			body: { v2: JSON.stringify(payload) },
		});
	});

	test("decode runs the member that wrote the value", async () => {
		const payload = { name: "alice" };
		expect(
			await switched.decode({
				codecName: "v2",
				body: { v2: JSON.stringify(payload) },
			})
		).toEqual(payload);
		expect(
			await switched.decode({
				codecName: "v1",
				body: { v1: JSON.stringify(payload) },
			})
		).toEqual(payload);
	});

	test("decode rejects a codecName that matches no member", async () => {
		await expect(
			switched.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toMatchObject({
			name: "UnknownCodecNameError",
			codecName: "v0",
			knownCodecNames: ["v2", "v1"],
			message: 'No codec named "v0"; known: "v2", "v1"',
		});
		await expect(
			switched.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toBeInstanceOf(UnknownCodecNameError);
	});

	test("decode rejects a value that was not encoded", async () => {
		await expect(switched.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidEncodedValueError",
			codecName: "v2",
		});
		await expect(switched.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidEncodedValueError);
	});

	test("rejects duplicate member names at construction", () => {
		expect(() => switchCodecs({ current, deprecated: [current] })).toThrow(DuplicateCodecNameError);
		expect(() => switchCodecs({ current, deprecated: [current] })).toThrow(
			'Codec names must be unique; "v2" appears more than once'
		);
	});

	test("exposes the current codec name", () => {
		expect(switchCodecs({ current, deprecated: [deprecated] }).codecName).toBe("v2");
	});

	test("reports the current member's output type", () => {
		expectTypeOf(switchCodecs({ current, deprecated: [deprecated] })).toEqualTypeOf<
			NamedCreateCodec<EncodedValue<{ v2: string }>>
		>();
	});
});
