import { noopCodec } from "./noop-codec";
import { describe, expect, test } from "bun:test";

describe("noopCodec", () => {
	test("encode wraps the payload in an encoded value", async () => {
		const payload = { name: "alice" };
		expect(await noopCodec.encode(payload)).toEqual({ encodedValue: payload });
	});

	test("decode unwraps the encoded value", async () => {
		const payload = { name: "alice" };
		expect(await noopCodec.decode({ encodedValue: payload })).toBe(payload);
	});
});
