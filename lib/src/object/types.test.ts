import { describe, expectTypeOf, test } from "vitest";

import type { AtMostOneProp, EmptyRecord, NonArrayObject, PathFromObject, RequireAtLeastOneProp } from "./types";

describe("NonArrayObject", () => {
	test("keeps an object or a function", () => {
		expectTypeOf<NonArrayObject<EmptyRecord>>().toEqualTypeOf<EmptyRecord>();
		expectTypeOf<NonArrayObject<() => unknown>>().toEqualTypeOf<() => unknown>();
	});

	test("turns a tuple or an array into never", () => {
		expectTypeOf<NonArrayObject<[]>>().toEqualTypeOf<never>();
		expectTypeOf<NonArrayObject<ReadonlyArray<unknown>>>().toEqualTypeOf<never>();
	});
});

describe("RequireAtLeastOneProp", () => {
	test("requires at least one of the given keys", () => {
		// RequireAtLeastOneProp builds each choice with `&`. `.branded` compares the combined
		// shape, so `{ a: string } & { b?: number }` matches `{ a: string; b?: number }`.
		expectTypeOf<RequireAtLeastOneProp<{ a?: string; b?: number; c?: boolean }, "a" | "b">>().branded.toEqualTypeOf<
			{ a: string; b?: number; c?: boolean } | { a?: string; b: number; c?: boolean }
		>();
	});

	test("requires at least one of all keys when no keys are given", () => {
		expectTypeOf<RequireAtLeastOneProp<{ a?: string; b?: number; c?: boolean }>>().branded.toEqualTypeOf<
			| { a: string; b?: number; c?: boolean }
			| { a?: string; b: number; c?: boolean }
			| { a?: string; b?: number; c: boolean }
		>();
	});

	test("a key that is already required stays required", () => {
		expectTypeOf<RequireAtLeastOneProp<{ a: string; b?: number; c?: boolean }, "a" | "b">>().branded.toEqualTypeOf<
			{ a: string; b?: number; c?: boolean } | { a: string; b: number; c?: boolean }
		>();
	});
});

describe("AtMostOneProp", () => {
	test("allows one key or none, and the other keys can be left out", () => {
		// AtMostOneProp builds each choice with `&`. `.branded` compares the combined shape,
		// so `{ a: string } & { b?: never }` matches `{ a: string; b?: never }`.
		expectTypeOf<AtMostOneProp<{ a: string; b: number; c: boolean }>>().branded.toEqualTypeOf<
			| { a: string; b?: never; c?: never }
			| { a?: never; b: number; c?: never }
			| { a?: never; b?: never; c: boolean }
			| { a?: never; b?: never; c?: never }
		>();
	});

	test("the key that is set keeps undefined and null in its value type", () => {
		expectTypeOf<AtMostOneProp<{ a?: string; b: number | null; c: boolean }>>().branded.toEqualTypeOf<
			| { a: string | undefined; b?: never; c?: never }
			| { a?: never; b: number | null; c?: never }
			| { a?: never; b?: never; c: boolean }
			| { a?: never; b?: never; c?: never }
		>();
	});
});

describe("PathFromObject", () => {
	test("an empty object has no paths", () => {
		// biome-ignore lint/complexity/noBannedTypes: testing that empty object has no paths
		expectTypeOf<PathFromObject<{}>>().toEqualTypeOf<never>();
	});

	test("a record with string keys gives string", () => {
		expectTypeOf<PathFromObject<Record<string, never>>>().toEqualTypeOf<string>();
	});

	test("a key whose value is never is still a path", () => {
		expectTypeOf<PathFromObject<{ a: never }>>().toEqualTypeOf<"a">();
	});

	test("names each key and each key of a nested object, optional keys included", () => {
		expectTypeOf<PathFromObject<{ a: string; b?: number; c: { d: boolean; e?: string[] } }>>().toEqualTypeOf<
			"a" | "b" | "c" | "c.d" | "c.e"
		>();
	});

	test("a key holding a union of strings is one path", () => {
		expectTypeOf<PathFromObject<{ union: "foo" | "bar" }>>().toEqualTypeOf<"union">();
	});

	test("stops at a key holding a union of objects", () => {
		expectTypeOf<
			PathFromObject<{ discriminatedUnion: { type: "foo"; foo: string } | { type: "bar"; bar: string } }>
		>().toEqualTypeOf<"discriminatedUnion">();
		expectTypeOf<
			PathFromObject<{ discriminatedUnion?: { type: "foo"; foo: string } | { type: "bar"; bar: string } }>
		>().toEqualTypeOf<"discriminatedUnion">();
		expectTypeOf<PathFromObject<{ either: { a: string } | { b: number } }>>().toEqualTypeOf<"either">();
		expectTypeOf<PathFromObject<{ outer: { inner: { type: "a" } | { type: "b" } } }>>().toEqualTypeOf<
			"outer" | "outer.inner"
		>();
	});
});
