import { prefixRangeEnd } from "./prefix-range";
import { describe, expect, test } from "bun:test";

describe("prefixRangeEnd", () => {
	test("advances the last character", () => {
		expect(prefixRangeEnd("send")).toBe("sene");
	});

	test("advances a character outside the Basic Multilingual Plane as one code point", () => {
		expect(prefixRangeEnd("a\u{1F600}")).toBe("a\u{1F601}");
	});

	test("skips the surrogate range", () => {
		expect(prefixRangeEnd("a\u{D7FF}")).toBe("a\u{E000}");
	});

	test("drops a trailing highest code point and advances the character before it", () => {
		expect(prefixRangeEnd("ab\u{10FFFF}\u{10FFFF}")).toBe("ac");
	});

	test("has no end for a prefix of only the highest code point", () => {
		expect(prefixRangeEnd("\u{10FFFF}")).toBeUndefined();
	});

	test("has no end for an empty prefix", () => {
		expect(prefixRangeEnd("")).toBeUndefined();
	});
});
