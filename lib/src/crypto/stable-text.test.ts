import { describe, expect, test } from "vitest";

import { InvalidStableTextError, stableText } from "./stable-text";

describe("stableText", () => {
	test("round-trips a value", () => {
		const input = { name: "alice", count: 3 };
		expect(stableText.decode(stableText.encode(input))).toEqual(input);
	});

	test("round-trips undefined via an empty envelope", () => {
		expect(stableText.decode(stableText.encode(undefined))).toBeUndefined();
		expect(new TextDecoder().decode(stableText.encode(undefined))).toBe("{}");
	});

	test("encode is stable across key order", () => {
		expect(stableText.encode({ a: 1, b: 2 })).toEqual(stableText.encode({ b: 2, a: 1 }));
	});

	test("wraps under the input key", () => {
		expect(new TextDecoder().decode(stableText.encode("x"))).toBe('{"input":"x"}');
	});

	test("rejects bytes that are not a { input } JSON object", () => {
		const decoderInput = (text: string) => new TextEncoder().encode(text);

		expect(() => stableText.decode(decoderInput("not-json"))).toThrow(InvalidStableTextError);
		expect(() => stableText.decode(decoderInput("null"))).toThrow(InvalidStableTextError);
		expect(() => stableText.decode(decoderInput('"x"'))).toThrow(InvalidStableTextError);
		expect(() => stableText.decode(decoderInput("[1]"))).toThrow(InvalidStableTextError);
		expect(() => stableText.decode(decoderInput('{"other":1}'))).toThrow(InvalidStableTextError);
		expect(() => stableText.decode(decoderInput('{"input":1,"extra":2}'))).toThrow(InvalidStableTextError);
	});
});
