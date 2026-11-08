import { describe, expect, test } from "vitest";

import { hashInput, sha256 } from "./hash";

const helloHash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("sha256", () => {
	test("matches known hash for 'hello'", async () => {
		expect(await sha256("hello")).toBe(helloHash);
	});
});

describe("hashInput", () => {
	test("produces deterministic hash for same input", async () => {
		const result1 = await hashInput({ name: "alice" });
		const result2 = await hashInput({ name: "alice" });
		expect(result1).toBe(result2);
	});

	test("produces same hash regardless of key order", async () => {
		const result1 = await hashInput({ a: 1, b: 2 });
		const result2 = await hashInput({ b: 2, a: 1 });
		expect(result1).toBe(result2);
	});

	test("produces different hash for different input", async () => {
		const result1 = await hashInput({ name: "alice" });
		const result2 = await hashInput({ name: "bob" });
		expect(result1).not.toBe(result2);
	});
});
