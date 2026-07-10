import { getCompositeId } from "./composite";
import { describe, expect, test } from "bun:test";

describe("getCompositeId", () => {
	test("without version id", () => {
		expect(() => getCompositeId({ name: "", referenceId: "abc123" })).toThrow("name cannot be empty");
		expect(() => getCompositeId({ name: "sendEmail", referenceId: "" })).toThrow("reference id cannot be empty");
		expect(getCompositeId({ name: "sendEmail", referenceId: "abc123" })).toBe("sendEmail:abc123");
	});

	test("with version id", () => {
		expect(() => getCompositeId({ name: "onboarding", versionId: "", referenceId: "ref-001" })).toThrow(
			"version id cannot be empty"
		);
		expect(getCompositeId({ name: "onboarding", versionId: "v1", referenceId: "ref-001" })).toBe(
			"onboarding:v1:ref-001"
		);
	});
});
