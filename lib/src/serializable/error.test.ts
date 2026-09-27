import { createSerializableError } from "./error";
import { describe, expect, test } from "bun:test";

describe("createSerializableError", () => {
	test("extracts message, name, and stack from an Error", () => {
		const err = new Error("something broke");
		const result = createSerializableError(err);
		expect(result.message).toBe("something broke");
		expect(result.name).toBe("Error");
		expect(result.stack).toBeDefined();
		expect(result.cause).toBeUndefined();
	});

	test("preserves custom error name", () => {
		const err = new TypeError("bad type");
		const result = createSerializableError(err);
		expect(result.name).toBe("TypeError");
	});

	test("serializes nested cause chain", () => {
		const root = new Error("root cause");
		const wrapper = new Error("wrapper", { cause: root });
		const result = createSerializableError(wrapper);
		expect(result.cause).toBeDefined();
		expect(result.cause?.message).toBe("root cause");
		expect(result.cause?.name).toBe("Error");
	});

	test("handles deeply nested cause chain", () => {
		const level0 = new Error("level 0");
		const level1 = new Error("level 1", { cause: level0 });
		const level2 = new Error("level 2", { cause: level1 });
		const result = createSerializableError(level2);
		expect(result.cause?.cause?.message).toBe("level 0");
	});

	test("has no cause when error has no cause", () => {
		const err = new Error("no cause");
		const result = createSerializableError(err);
		expect(result.cause).toBeUndefined();
	});

	test("converts non-Error value to UnknownError", () => {
		const result = createSerializableError("string error");
		expect(result.message).toBe("string error");
		expect(result.name).toBe("UnknownError");
		expect(result.stack).toBeUndefined();
		expect(result.cause).toBeUndefined();
	});

	test("converts numeric value to UnknownError", () => {
		const result = createSerializableError(42);
		expect(result.message).toBe("42");
		expect(result.name).toBe("UnknownError");
	});

	test("converts null to UnknownError", () => {
		const result = createSerializableError(null);
		expect(result.message).toBe("null");
		expect(result.name).toBe("UnknownError");
	});
});
