import { stableStringify } from "./stable-stringify";
import { describe, expect, test } from "bun:test";

describe("stableStringify", () => {
	test("sorts object keys alphabetically", () => {
		expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
	});

	test("produces identical output regardless of key insertion order", () => {
		const result1 = stableStringify({ b: 2, a: 1, c: 3 });
		const result2 = stableStringify({ c: 3, a: 1, b: 2 });
		expect(result1).toBe(result2);
	});

	test("sorts keys in nested objects", () => {
		expect(stableStringify({ z: { b: 2, a: 1 } })).toBe('{"z":{"a":1,"b":2}}');
	});

	test("serializes string values", () => {
		expect(stableStringify({ name: "alice" })).toBe('{"name":"alice"}');
	});

	test("serializes boolean values", () => {
		expect(stableStringify({ active: true })).toBe('{"active":true}');
	});

	test("serializes null values", () => {
		expect(stableStringify({ value: null })).toBe('{"value":null}');
	});

	test("omits undefined values", () => {
		expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
	});

	test("serializes arrays preserving order", () => {
		expect(stableStringify({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}');
	});

	test("sorts keys within each object in an array without reordering elements", () => {
		expect(
			stableStringify({
				items: [
					{ b: 2, a: 1 },
					{ d: 4, c: 3 },
				],
			})
		).toBe('{"items":[{"a":1,"b":2},{"c":3,"d":4}]}');
	});

	test("serializes empty object", () => {
		expect(stableStringify({})).toBe("{}");
	});

	test("serializes empty array value", () => {
		expect(stableStringify({ items: [] })).toBe('{"items":[]}');
	});

	test("serializes NaN as null", () => {
		expect(stableStringify({ value: NaN })).toBe('{"value":null}');
	});

	test("serializes Infinity as null", () => {
		expect(stableStringify({ value: Infinity })).toBe('{"value":null}');
	});

	test("serializes undefined inside arrays as null", () => {
		expect(stableStringify({ items: [1, undefined, 3] })).toBe('{"items":[1,null,3]}');
	});

	test("serializes Date as empty object", () => {
		expect(stableStringify({ value: new Date("2024-01-01") })).toBe('{"value":{}}');
	});

	test("serializes RegExp as empty object", () => {
		expect(stableStringify({ value: /test/ })).toBe('{"value":{}}');
	});

	test("throws on function value", () => {
		expect(() => stableStringify({ value: () => {} })).toThrow("function");
	});

	test("throws on symbol value", () => {
		expect(() => stableStringify({ value: Symbol("x") })).toThrow("symbol");
	});

	test("throws on function nested inside object", () => {
		expect(() => stableStringify({ nested: { callback: () => {} } })).toThrow("function");
	});

	test("throws on function inside array", () => {
		expect(() => stableStringify({ items: [1, () => {}, 3] })).toThrow("function");
	});

	test("throws on promise value", () => {
		expect(() => stableStringify({ value: Promise.resolve() })).toThrow("Promise");
	});

	test("throws on promise inside array", () => {
		expect(() => stableStringify({ items: [Promise.resolve()] })).toThrow("Promise");
	});
});
