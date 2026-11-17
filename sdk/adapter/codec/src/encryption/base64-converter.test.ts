import { describe, expect, test } from "vitest";

import { bytesToBase64WithBtoa } from "./base64-converter";

describe("bytesToBase64WithBtoa", () => {
	test("encodes an empty payload", () => {
		expect(bytesToBase64WithBtoa(new Uint8Array(0))).toBe("");
	});

	test("encodes ASCII bytes as standard base64", () => {
		expect(bytesToBase64WithBtoa(new TextEncoder().encode("hello"))).toBe("aGVsbG8=");
	});

	test("encodes bytes that need padding and the full alphabet", () => {
		expect(bytesToBase64WithBtoa(new Uint8Array([0xff, 0xef, 0x00]))).toBe("/+8A");
	});

	test("encodes a payload larger than one fromCharCode chunk", () => {
		const bytes = new Uint8Array(0x8000 + 1).fill(0xa5);
		expect(bytesToBase64WithBtoa(bytes)).toBe(
			Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
		);
	});
});
