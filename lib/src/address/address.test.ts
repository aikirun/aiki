import { getTaskAddress, getWorkflowRunAddress } from "./index";
import { describe, expect, test } from "bun:test";

describe("getTaskAddress", () => {
	test("joins name and input hash with colon", () => {
		expect(getTaskAddress("sendEmail", "abc123")).toBe("sendEmail:abc123");
	});
});

describe("getWorkflowRunAddress", () => {
	test("joins name, version id, and reference id with colons", () => {
		expect(getWorkflowRunAddress("onboarding", "v1", "ref-001")).toBe("onboarding:v1:ref-001");
	});
});
