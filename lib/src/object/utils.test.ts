import { getByPath, omitUndefined } from "./utils";
import { describe, expect, test } from "bun:test";

describe("getByPath", () => {
	const obj = {
		a: 1,
		b: {
			c: "hello",
			d: {
				e: true,
			},
		},
	};

	test("gets a top-level value", () => {
		expect(getByPath(obj, "a")).toBe(1);
	});

	test("gets a nested value", () => {
		expect(getByPath(obj, "b.c")).toBe("hello");
	});

	test("gets a deeply nested value", () => {
		expect(getByPath(obj, "b.d.e")).toBe(true);
	});

	test("returns undefined for missing nested path", () => {
		const partial = { a: 1 } as { a: number; b?: { c: string } };
		expect(getByPath(partial, "b.c")).toBeUndefined();
	});

	test("returns undefined when intermediate is null", () => {
		const withNull = { a: null } as { a: { b: string } | null };
		expect(getByPath(withNull, "a.b")).toBeUndefined();
	});
});

describe("omitUndefined", () => {
	test("removes top-level undefined values", () => {
		expect(omitUndefined({ a: 1, b: undefined })).toEqual({ a: 1 });
	});

	test("removes nested undefined values", () => {
		expect(omitUndefined({ a: { b: 1, c: undefined } })).toEqual({ a: { b: 1 } });
	});

	test("preserves null values", () => {
		expect(omitUndefined({ a: null })).toEqual({ a: null });
	});

	test("preserves falsy values", () => {
		expect(omitUndefined({ a: 0, b: "", c: false })).toEqual({ a: 0, b: "", c: false });
	});

	test("preserves arrays as-is", () => {
		expect(omitUndefined({ a: [1, 2, 3] })).toEqual({ a: [1, 2, 3] });
	});

	test("returns empty object when all values are undefined", () => {
		expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
	});

	test("handles deeply nested objects", () => {
		expect(omitUndefined({ a: { b: { c: undefined, d: 1 } } })).toEqual({ a: { b: { d: 1 } } });
	});
});
