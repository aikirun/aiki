import { getWorkflowQueueName } from "./key";
import { describe, expect, test } from "bun:test";

describe("getWorkflowQueueName", () => {
	test("preserves ordinary queue names", () => {
		expect(getWorkflowQueueName({ source: "user", name: "billing", versionId: "1.0.0" })).toBe(
			"aiki:workflow:user:billing:1.0.0"
		);
		expect(getWorkflowQueueName({ source: "user", name: "billing", versionId: "1.0.0", pool: "dedicated" })).toBe(
			"aiki:workflow:user:billing:1.0.0:dedicated"
		);
	});

	const collisions = [
		{
			label: "name and version",
			first: { name: "billing:v2", versionId: "1.0.0", expected: "aiki:workflow:user:billing%3Av2:1.0.0" },
			second: { name: "billing", versionId: "v2:1.0.0", expected: "aiki:workflow:user:billing:v2%3A1.0.0" },
		},
		{
			label: "version and pool",
			first: {
				name: "billing",
				versionId: "1.0.0:dedicated",
				expected: "aiki:workflow:user:billing:1.0.0%3Adedicated",
			},
			second: {
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated",
				expected: "aiki:workflow:user:billing:1.0.0:dedicated",
			},
		},
		{
			label: "colons within pools",
			first: {
				name: "billing",
				versionId: "1.0.0:dedicated",
				pool: "east",
				expected: "aiki:workflow:user:billing:1.0.0%3Adedicated:east",
			},
			second: {
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated:east",
				expected: "aiki:workflow:user:billing:1.0.0:dedicated%3Aeast",
			},
		},
	];
	for (const { label, first, second } of collisions) {
		test(`distinguishes delimiters in ${label}`, () => {
			const firstQueueName = getWorkflowQueueName({ source: "user", ...first });
			const secondQueueName = getWorkflowQueueName({ source: "user", ...second });

			expect(firstQueueName).toBe(first.expected);
			expect(secondQueueName).toBe(second.expected);
			expect(firstQueueName).not.toBe(secondQueueName);
		});
	}

	const escapedFields = {
		name: ["aiki:workflow:user:a%3Ab:1.0.0:dedicated", "aiki:workflow:user:a%253Ab:1.0.0:dedicated"],
		versionId: ["aiki:workflow:user:billing:a%3Ab:dedicated", "aiki:workflow:user:billing:a%253Ab:dedicated"],
		pool: ["aiki:workflow:user:billing:1.0.0:a%3Ab", "aiki:workflow:user:billing:1.0.0:a%253Ab"],
	};
	for (const [field, expected] of Object.entries(escapedFields)) {
		test(`distinguishes literal escape sequences in ${field}`, () => {
			const workflow = { source: "user" as const, name: "billing", versionId: "1.0.0", pool: "dedicated" };
			expect([
				getWorkflowQueueName({ ...workflow, [field]: "a:b" }),
				getWorkflowQueueName({ ...workflow, [field]: "a%3Ab" }),
			]).toEqual(expected);
		});
	}
});
