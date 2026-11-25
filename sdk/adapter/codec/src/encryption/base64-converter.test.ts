import { describe, expect, test } from "vitest";

import { base64ToBytesWithAtob, bytesToBase64UrlWithBtoa, bytesToBase64WithBtoa } from "./base64-converter";

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

describe("base64ToBytesWithAtob", () => {
	test("decodes an empty string", () => {
		expect(base64ToBytesWithAtob("")).toEqual(new Uint8Array(0));
	});

	test("decodes standard base64 with padding", () => {
		expect(base64ToBytesWithAtob("aGVsbG8=")).toEqual(new TextEncoder().encode("hello"));
	});

	test("decodes bytes that use the full alphabet", () => {
		expect(base64ToBytesWithAtob("/+8A")).toEqual(new Uint8Array([0xff, 0xef, 0x00]));
	});
});

describe("bytesToBase64UrlWithBtoa", () => {
	test("writes - and _ where standard base64 has + and /", () => {
		expect(bytesToBase64UrlWithBtoa(new Uint8Array([0xff, 0xef, 0x00]))).toBe("_-8A");
	});

	test("drops one or two padding characters", () => {
		expect(bytesToBase64UrlWithBtoa(new TextEncoder().encode("hello"))).toBe("aGVsbG8");
		expect(bytesToBase64UrlWithBtoa(new Uint8Array([0xff]))).toBe("_w");
	});
});
