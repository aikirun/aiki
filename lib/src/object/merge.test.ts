import { merge } from "./merge";
import { describe, expect, test } from "bun:test";

describe("merge", () => {
	test("returns the defaults when overrides are omitted", () => {
		const defaults = { a: 1, b: 2 };
		expect(merge(defaults)).toEqual({ a: 1, b: 2 });
	});

	test("returns the defaults when overrides are undefined", () => {
		const defaults = { a: 1, b: 2 };
		expect(merge(defaults, undefined)).toEqual({ a: 1, b: 2 });
	});

	test("replaces a top-level primitive", () => {
		expect(merge({ a: 1, b: 2 }, { a: 99 })).toEqual({ a: 99, b: 2 });
	});

	test("merges a nested object, preserving untouched siblings", () => {
		const defaults = { nested: { x: 30_000, y: 10 }, top: 5_000 };
		expect(merge(defaults, { nested: { y: 0 } })).toEqual({
			nested: { x: 30_000, y: 0 },
			top: 5_000,
		});
	});

	test("merges through multiple levels of nesting", () => {
		const defaults = { a: { b: { c: 1, d: 2 } } };
		expect(merge(defaults, { a: { b: { d: 20 } } })).toEqual({ a: { b: { c: 1, d: 20 } } });
	});

	test("keeps falsy overrides — 0, false, empty string are not dropped", () => {
		const defaults = { count: 5, flag: true, label: "default" };
		expect(merge(defaults, { count: 0, flag: false, label: "" })).toEqual({
			count: 0,
			flag: false,
			label: "",
		});
	});

	test("skips overrides whose value is undefined, keeping the default", () => {
		const defaults = { a: 1, b: 2 };
		expect(merge(defaults, { a: undefined, b: 3 })).toEqual({ a: 1, b: 3 });
	});

	test("does not mutate the defaults", () => {
		const defaults = { nested: { x: 1, y: 2 } };
		merge(defaults, { nested: { x: 99 } });
		expect(defaults).toEqual({ nested: { x: 1, y: 2 } });
	});

	test("replaces arrays wholesale rather than merging by index", () => {
		const defaults = { list: [1, 2, 3] };
		expect(merge(defaults, { list: [9] })).toEqual({ list: [9] });
	});

	test("replaces an object default with a primitive override", () => {
		const defaults = { value: { x: 1 } as { x: number } | number };
		expect(merge(defaults, { value: 42 })).toEqual({ value: 42 });
	});

	test("leaves nested default object references intact when not overridden", () => {
		const inner = { x: 1, y: 2 };
		const defaults = { a: inner, b: { z: 3 } };
		const result = merge(defaults, { b: { z: 30 } });
		expect(result).toEqual({ a: { x: 1, y: 2 }, b: { z: 30 } });
	});
});
