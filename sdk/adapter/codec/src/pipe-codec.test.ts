import { noopLogger } from "@aikirun/lib/logger";
import { describe, expect, expectTypeOf, test } from "vitest";

import { codec, type EncodedValue, type NamedCreateCodec } from "./codec";
import { pipeCodecs } from "./pipe-codec";

describe("pipeCodecs", () => {
	const inner = codec({
		name: "inner",
		encode: (payload) => ({ inner: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.inner),
	});
	const middle = codec({
		name: "middle",
		encode: (payload) => ({ middle: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.middle),
	});
	const outer = codec({
		name: "outer",
		encode: (payload) => ({ outer: JSON.stringify(payload) }),
		decode: (encoded) => JSON.parse(encoded.outer),
	});
	const piped = pipeCodecs(inner, middle, outer)({ logger: noopLogger });

	test("encode stacks codecs in order", async () => {
		const payload = { name: "alice" };
		expect(await piped.encode(payload)).toEqual({
			codecName: "outer",
			body: {
				outer: JSON.stringify({
					codecName: "middle",
					body: {
						middle: JSON.stringify({
							codecName: "inner",
							body: { inner: JSON.stringify(payload) },
						}),
					},
				}),
			},
		});
	});

	test("decode reverses the stack and recovers the payload", async () => {
		const payload = { name: "alice" };
		const encoded = await piped.encode(payload);
		expect(await piped.decode(encoded)).toEqual(payload);
	});

	test("exposes the outermost codec name", () => {
		expect(pipeCodecs(inner, middle, outer).codecName).toBe("outer");
		expect(pipeCodecs(inner).codecName).toBe("inner");
	});

	test("reports the outermost member's output type", () => {
		expectTypeOf(pipeCodecs(inner, middle, outer)).toEqualTypeOf<NamedCreateCodec<EncodedValue<{ outer: string }>>>();
		expectTypeOf(pipeCodecs(inner)).toEqualTypeOf<NamedCreateCodec<EncodedValue<{ inner: string }>>>();
	});
});
