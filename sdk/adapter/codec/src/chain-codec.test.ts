import { noopLogger } from "@aikirun/lib/logger";

import { chainCodecs, DuplicateChainedCodecNameError, UnknownChainedCodecNameError } from "./chain-codec";
import { codec, InvalidCodecPayloadFormatError } from "./codec";
import { describe, expect, test } from "bun:test";

describe("chainCodecs", () => {
	const newCodec = codec({
		name: "v2",
		encode: (payload) => ({ v2: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("v2" in body)) {
				throw new Error("unexpected v2 body");
			}
			return body.v2;
		},
	});
	const oldCodec = codec({
		name: "v1",
		encode: (payload) => ({ v1: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("v1" in body)) {
				throw new Error("unexpected v1 body");
			}
			return body.v1;
		},
	});
	const chained = chainCodecs(newCodec, oldCodec)({ logger: noopLogger });

	test("encode uses the first member", async () => {
		const payload = { name: "alice" };
		expect(await chained.encode(payload)).toEqual({
			codecName: "v2",
			body: { v2: payload },
		});
	});

	test("decode runs the member that wrote the value", async () => {
		const payload = { name: "alice" };
		expect(
			await chained.decode({
				codecName: "v2",
				body: { v2: payload },
			})
		).toEqual(payload);
		expect(
			await chained.decode({
				codecName: "v1",
				body: { v1: payload },
			})
		).toEqual(payload);
	});

	test("decode rejects a codecName that matches no member", async () => {
		expect(
			chained.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toMatchObject({
			name: "UnknownChainedCodecNameError(v0)",
			codecName: "v0",
			knownCodecNames: ["v2", "v1"],
			message: 'No chained codec named "v0"; known: "v2", "v1"',
		});
		expect(
			chained.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toBeInstanceOf(UnknownChainedCodecNameError);
	});

	test("decode rejects a payload without the envelope", async () => {
		expect(chained.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidCodecPayloadFormatError(v2)",
			codecName: "v2",
		});
		expect(chained.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidCodecPayloadFormatError);
	});

	test("rejects duplicate member names at construction", () => {
		expect(() => chainCodecs(newCodec, newCodec)).toThrow(DuplicateChainedCodecNameError);
		expect(() => chainCodecs(newCodec, newCodec)).toThrow(
			'Chained codecs must have unique names; "v2" appears more than once'
		);
	});

	test("exposes the primary codec name", () => {
		expect(chainCodecs(newCodec, oldCodec).codecName).toBe("v2");
	});
});
