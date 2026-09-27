import type { Serializable } from "./types";
import { describe, expectTypeOf, test } from "bun:test";

interface Order {
	id: string;
	lines: { sku: string; quantity: number }[];
	note?: string;
}

class Point {
	constructor(
		public x: number,
		public y: number
	) {}
}

class Counter {
	count = 0;

	increment() {
		this.count += 1;
	}
}

type Tree = { name: string; children: Tree[] };

type ParsedJson = ReturnType<typeof JSON.parse>;

describe("Serializable", () => {
	describe("resolves to unknown when data is JSON serializable", () => {
		test("scalars", () => {
			expectTypeOf<Serializable<string | number | boolean | null, "output">>().toEqualTypeOf<unknown>();
		});

		test("void", () => {
			expectTypeOf<Serializable<void, "output">>().toEqualTypeOf<unknown>();
		});

		test("an interface", () => {
			expectTypeOf<Serializable<Order, "output">>().toEqualTypeOf<unknown>();
		});

		test("a class with only data fields", () => {
			expectTypeOf<Serializable<Point, "output">>().toEqualTypeOf<unknown>();
		});

		test("a recursive type", () => {
			expectTypeOf<Serializable<Tree, "output">>().toEqualTypeOf<unknown>();
		});

		test("a tuple", () => {
			expectTypeOf<Serializable<readonly [string, number], "output">>().toEqualTypeOf<unknown>();
		});

		test("a union of object shapes", () => {
			expectTypeOf<
				Serializable<{ kind: "card"; last4: string } | { kind: "cash"; tendered: number }, "output">
			>().toEqualTypeOf<unknown>();
		});
	});

	describe("names the path of each value that is non serializable", () => {
		test("a Date nested in an object", () => {
			expectTypeOf<Serializable<{ user: { name: string; createdAt: Date } }, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output.user.createdAt is Date";
			}>();
		});

		test("a Date inside an array", () => {
			expectTypeOf<Serializable<{ rows: { seen: Date }[] }, "input">>().toEqualTypeOf<{
				"Aiki: not serializable": "input.rows[].seen is Date";
			}>();
		});

		test("any", () => {
			expectTypeOf<Serializable<ParsedJson, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output is any";
			}>();
		});

		test("unknown", () => {
			expectTypeOf<Serializable<unknown, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output is unknown";
			}>();
		});

		test("a Map", () => {
			expectTypeOf<Serializable<Map<string, number>, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output is Map";
			}>();
		});

		test("a Set", () => {
			expectTypeOf<Serializable<{ tags: Set<string> }, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output.tags is Set";
			}>();
		});

		test("a bigint", () => {
			expectTypeOf<Serializable<{ total: bigint }, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output.total is bigint";
			}>();
		});

		test("a method on a class instance", () => {
			expectTypeOf<Serializable<Counter, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output.increment is a function";
			}>();
		});

		test("a union with a Date member", () => {
			expectTypeOf<Serializable<string | Date, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output is Date";
			}>();
		});

		test("every offending path at once", () => {
			expectTypeOf<Serializable<{ at: Date; total: bigint }, "output">>().toEqualTypeOf<{
				"Aiki: not serializable": "output.at is Date" | "output.total is bigint";
			}>();
		});
	});
});
