import { propsDefined, propsRequiredNonNull } from "./guard";
import { describe, expect, test } from "bun:test";

describe("propsDefined", () => {
	test("returns true when single prop is defined", () => {
		expect(propsDefined({ a: 1, b: undefined }, "a")).toBe(true);
	});

	test("returns false when single prop is undefined", () => {
		expect(propsDefined({ a: undefined, b: 2 }, "a")).toBe(false);
	});

	test("returns true when all checked props are defined", () => {
		expect(propsDefined({ a: 1, b: "hello", c: undefined }, "a", "b")).toBe(true);
	});

	test("returns false when any checked prop is undefined", () => {
		expect(propsDefined({ a: 1, b: undefined, c: 3 }, "a", "b")).toBe(false);
	});

	test("treats null as defined", () => {
		expect(propsDefined({ a: null }, "a")).toBe(true);
	});

	test("treats falsy values as defined", () => {
		expect(propsDefined({ a: 0, b: "", c: false }, "a", "b", "c")).toBe(true);
	});
});

describe("propsRequiredNonNull", () => {
	test("returns true when prop is defined and non-null", () => {
		expect(propsRequiredNonNull({ a: 1 }, "a")).toBe(true);
	});

	test("returns false when prop is undefined", () => {
		expect(propsRequiredNonNull({ a: undefined }, "a")).toBe(false);
	});

	test("returns false when prop is null", () => {
		expect(propsRequiredNonNull({ a: null }, "a")).toBe(false);
	});

	test("returns true when all checked props are non-null and defined", () => {
		expect(propsRequiredNonNull({ a: 1, b: "hello" }, "a", "b")).toBe(true);
	});

	test("returns false when any checked prop is null", () => {
		expect(propsRequiredNonNull({ a: 1, b: null }, "a", "b")).toBe(false);
	});

	test("treats falsy non-null values as valid", () => {
		expect(propsRequiredNonNull({ a: 0, b: "", c: false }, "a", "b", "c")).toBe(true);
	});
});
