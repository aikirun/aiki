import { describe, expectTypeOf, test } from "vitest";

import type { NonEmptyArray } from "./types";

describe("NonEmptyArray", () => {
	test("is a tuple with one item followed by any number more", () => {
		expectTypeOf<NonEmptyArray<number>>().toEqualTypeOf<[number, ...number[]]>();
	});

	test("is not an empty tuple, a one-item tuple or a plain array", () => {
		expectTypeOf<NonEmptyArray<number>>().not.toEqualTypeOf<[]>();
		expectTypeOf<NonEmptyArray<number>>().not.toEqualTypeOf<[number]>();
		expectTypeOf<NonEmptyArray<number>>().not.toEqualTypeOf<number[]>();
	});
});
