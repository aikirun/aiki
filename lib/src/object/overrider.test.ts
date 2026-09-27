import { objectOverrider } from "./overrider";
import { describe, expect, test } from "bun:test";

interface TestObject {
	name: string;
	retry: {
		type: "never" | "fixed";
		maxAttempts?: number;
	};
	metadata?: {
		label: string;
		priority: number;
	};
}

const defaultTestObject: TestObject = {
	name: "default",
	retry: { type: "never" },
};

const testObjectOverrider = objectOverrider(defaultTestObject);

describe("objectOverrider", () => {
	test("returns defaults when no overrides are applied", () => {
		expect(testObjectOverrider().build()).toEqual(defaultTestObject);
	});

	test("does not mutate the defaults object", () => {
		testObjectOverrider().with("name", "changed").build();
		expect(defaultTestObject.name).toBe("default");
	});

	test("overrides a top-level field", () => {
		const result = testObjectOverrider().with("name", "custom").build();
		expect(result.name).toBe("custom");
	});

	test("overrides a nested field", () => {
		const result = testObjectOverrider().with("retry.type", "fixed").build();
		expect(result.retry.type).toBe("fixed");
	});

	test("chains multiple overrides", () => {
		const result = testObjectOverrider().with("retry.type", "fixed").with("retry.maxAttempts", 5).build();
		expect(result.retry).toEqual({ type: "fixed", maxAttempts: 5 });
	});

	test("later overrides win for the same path", () => {
		const result = testObjectOverrider().with("name", "first").with("name", "second").build();
		expect(result.name).toBe("second");
	});

	test("accepts a base object instead of defaults", () => {
		const base = { name: "base", retry: { type: "fixed" as const, maxAttempts: 3 } };
		const result = testObjectOverrider(base).with("name", "overridden").build();
		expect(result).toEqual({ name: "overridden", retry: { type: "fixed", maxAttempts: 3 } });
	});

	test("does not mutate the base object", () => {
		const base = { name: "base", retry: { type: "fixed" as const, maxAttempts: 3 } };
		testObjectOverrider(base).with("name", "changed").build();
		expect(base.name).toBe("base");
	});

	test("creates independent builders from the same factory", () => {
		const builderA = testObjectOverrider().with("name", "a");
		const builderB = testObjectOverrider().with("name", "b");
		expect(builderA.build().name).toBe("a");
		expect(builderB.build().name).toBe("b");
	});

	test("overrides an entire nested object at a non-leaf path", () => {
		const result = testObjectOverrider().with("retry", { type: "fixed", maxAttempts: 5 }).build();
		expect(result.retry).toEqual({ type: "fixed", maxAttempts: 5 });
	});

	test("creates intermediate object when setting nested path on undefined parent", () => {
		const result = testObjectOverrider().with("metadata.label", "important").build();
		expect(result.metadata?.label).toBe("important");
		expect(result.metadata?.priority).toBeUndefined();
	});

	describe("prototype pollution guard", () => {
		// PathFromObject rejects these paths at compile time; widening models a plain-JavaScript caller
		const untypedBuilder = () =>
			testObjectOverrider() as unknown as { with(path: string, value: unknown): { build(): TestObject } };

		test("throws when a path segment is __proto__", () => {
			expect(() => untypedBuilder().with("__proto__.injected", true).build()).toThrow(
				'Cannot set path "__proto__.injected": segment "__proto__" is not allowed'
			);
		});

		test("throws when a path segment is constructor", () => {
			expect(() => untypedBuilder().with("constructor.prototype.injected", true).build()).toThrow(
				'Cannot set path "constructor.prototype.injected": segment "constructor" is not allowed'
			);
		});

		test("throws when a path segment is prototype", () => {
			expect(() => untypedBuilder().with("metadata.prototype", true).build()).toThrow(
				'Cannot set path "metadata.prototype": segment "prototype" is not allowed'
			);
		});

		test("does not pollute Object.prototype when a hostile path is attempted", () => {
			try {
				untypedBuilder().with("__proto__.injected", true).build();
			} catch {
				// the guard throws; this test only asserts the absence of pollution
			}
			expect(({} as Record<string, unknown>).injected).toBeUndefined();
		});
	});
});
