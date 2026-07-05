import { getSafeRedirect } from "./redirect";
import { describe, expect, test } from "bun:test";

const origin = "https://dashboard.example.com";

describe("getSafeRedirect", () => {
	test("returns a same-origin path", () => {
		expect(getSafeRedirect("?redirect=%2Finvitations%2Fabc", origin)).toBe("/invitations/abc");
	});

	test("preserves query and hash on the redirect path", () => {
		expect(getSafeRedirect("?redirect=%2Fruns%3Ftab%3Devents%23latest", origin)).toBe("/runs?tab=events#latest");
	});

	test("returns null when the param is absent", () => {
		expect(getSafeRedirect("", origin)).toBeNull();
		expect(getSafeRedirect("?other=value", origin)).toBeNull();
	});

	test("rejects absolute URLs", () => {
		expect(getSafeRedirect("?redirect=https%3A%2F%2Fevil.example.net%2Fphish", origin)).toBeNull();
	});

	test("rejects same-origin absolute URLs (only paths are allowed)", () => {
		expect(getSafeRedirect(`?redirect=${encodeURIComponent(`${origin}/runs`)}`, origin)).toBeNull();
	});

	test("rejects protocol-relative URLs", () => {
		expect(getSafeRedirect("?redirect=%2F%2Fevil.example.net%2Fphish", origin)).toBeNull();
	});

	test("rejects backslash protocol-relative URLs", () => {
		expect(getSafeRedirect("?redirect=%2F%5Cevil.example.net", origin)).toBeNull();
	});

	test("rejects javascript: URLs", () => {
		expect(getSafeRedirect("?redirect=javascript%3Aalert(1)", origin)).toBeNull();
	});
});
