import { noopLogger } from "@aikirun/lib/logger";

import { codec, InvalidEncodedValueError } from "./codec";
import { DuplicateCodecNameError, switchCodecs, UnknownCodecNameError } from "./switch-codec";
import { describe, expect, test } from "bun:test";

describe("switchCodecs", () => {
	const current = codec({
		name: "v2",
		encode: (payload) => ({ v2: payload }),
		decode: (encoded) => {
			if (typeof encoded !== "object" || encoded === null || !("v2" in encoded)) {
				throw new Error("unexpected v2 encoded value");
			}
			return encoded.v2;
		},
	});
	const deprecated = codec({
		name: "v1",
		encode: (payload) => ({ v1: payload }),
		decode: (encoded) => {
			if (typeof encoded !== "object" || encoded === null || !("v1" in encoded)) {
				throw new Error("unexpected v1 encoded value");
			}
			return encoded.v1;
		},
	});
	const switched = switchCodecs({ current, deprecated: [deprecated] })({ logger: noopLogger });

	test("encode uses the current member", async () => {
		const payload = { name: "alice" };
		expect(await switched.encode(payload)).toEqual({
			codecName: "v2",
			body: { v2: payload },
		});
	});

	test("decode runs the member that wrote the value", async () => {
		const payload = { name: "alice" };
		expect(
			await switched.decode({
				codecName: "v2",
				body: { v2: payload },
			})
		).toEqual(payload);
		expect(
			await switched.decode({
				codecName: "v1",
				body: { v1: payload },
			})
		).toEqual(payload);
	});

	test("decode rejects a codecName that matches no member", async () => {
		expect(
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
		expect(
			switched.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toBeInstanceOf(UnknownCodecNameError);
	});

	test("decode rejects a value that was not encoded", async () => {
		expect(switched.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidEncodedValueError",
			codecName: "v2",
		});
		expect(switched.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidEncodedValueError);
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
});
