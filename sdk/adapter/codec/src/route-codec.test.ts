import { noopLogger } from "@aikirun/lib/logger";

import { codec, InvalidCodecPayloadFormatError } from "./codec";
import { DuplicateRoutedCodecNameError, routeCodecs, UnknownCodecNameInPayloadError } from "./route-codec";
import { describe, expect, test } from "bun:test";

describe("routeCodecs", () => {
	const current = codec({
		name: "v2",
		encode: (payload) => ({ v2: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("v2" in body)) {
				throw new Error("unexpected v2 body");
			}
			return body.v2;
		},
	});
	const deprecated = codec({
		name: "v1",
		encode: (payload) => ({ v1: payload }),
		decode: (body) => {
			if (typeof body !== "object" || body === null || !("v1" in body)) {
				throw new Error("unexpected v1 body");
			}
			return body.v1;
		},
	});
	const routed = routeCodecs({ current, deprecated: [deprecated] })({ logger: noopLogger });

	test("encode uses the current member", async () => {
		const payload = { name: "alice" };
		expect(await routed.encode(payload)).toEqual({
			codecName: "v2",
			body: { v2: payload },
		});
	});

	test("decode runs the member that wrote the value", async () => {
		const payload = { name: "alice" };
		expect(
			await routed.decode({
				codecName: "v2",
				body: { v2: payload },
			})
		).toEqual(payload);
		expect(
			await routed.decode({
				codecName: "v1",
				body: { v1: payload },
			})
		).toEqual(payload);
	});

	test("decode rejects a codecName that matches no member", async () => {
		expect(
			routed.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toMatchObject({
			name: "UnknownCodecNameInPayloadError(v0)",
			codecName: "v0",
			knownCodecNames: ["v2", "v1"],
			message: 'No routed codec named "v0"; known: "v2", "v1"',
		});
		expect(
			routed.decode({
				codecName: "v0",
				body: { v0: { name: "alice" } },
			})
		).rejects.toBeInstanceOf(UnknownCodecNameInPayloadError);
	});

	test("decode rejects a payload without the envelope", async () => {
		expect(routed.decode({ name: "alice" })).rejects.toMatchObject({
			name: "InvalidCodecPayloadFormatError(v2)",
			codecName: "v2",
		});
		expect(routed.decode({ name: "alice" })).rejects.toBeInstanceOf(InvalidCodecPayloadFormatError);
	});

	test("rejects duplicate member names at construction", () => {
		expect(() => routeCodecs({ current, deprecated: [current] })).toThrow(DuplicateRoutedCodecNameError);
		expect(() => routeCodecs({ current, deprecated: [current] })).toThrow(
			'Routed codecs must have unique names; "v2" appears more than once'
		);
	});

	test("exposes the current codec name", () => {
		expect(routeCodecs({ current, deprecated: [deprecated] }).codecName).toBe("v2");
	});
});
