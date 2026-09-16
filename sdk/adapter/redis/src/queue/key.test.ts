import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import { getWorkflowQueueName, getWorkflowQueueNames } from "./key";
import { describe, expect, test } from "bun:test";

describe("getWorkflowQueueName", () => {
	test("builds the queue name with the namespace as a hash tag", () => {
		expect(getWorkflowQueueName({ namespaceId: "acme", source: "user", name: "billing", versionId: "1.0.0" })).toBe(
			"aiki:{acme}:workflow:user:billing:1.0.0"
		);
		expect(
			getWorkflowQueueName({
				namespaceId: "acme",
				source: "user",
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated",
			})
		).toBe("aiki:{acme}:workflow:user:billing:1.0.0:dedicated");
	});

	test("escapes braces in the namespace so they cannot end the hash tag early", () => {
		expect(getWorkflowQueueName({ namespaceId: "ac}me{", source: "user", name: "billing", versionId: "1.0.0" })).toBe(
			"aiki:{ac%7Dme%7B}:workflow:user:billing:1.0.0"
		);
	});

	const collisions = [
		{
			label: "name and version",
			first: { name: "billing:v2", versionId: "1.0.0", expected: "aiki:{acme}:workflow:user:billing%3Av2:1.0.0" },
			second: { name: "billing", versionId: "v2:1.0.0", expected: "aiki:{acme}:workflow:user:billing:v2%3A1.0.0" },
		},
		{
			label: "version and pool",
			first: {
				name: "billing",
				versionId: "1.0.0:dedicated",
				expected: "aiki:{acme}:workflow:user:billing:1.0.0%3Adedicated",
			},
			second: {
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated",
				expected: "aiki:{acme}:workflow:user:billing:1.0.0:dedicated",
			},
		},
		{
			label: "colons within pools",
			first: {
				name: "billing",
				versionId: "1.0.0:dedicated",
				pool: "east",
				expected: "aiki:{acme}:workflow:user:billing:1.0.0%3Adedicated:east",
			},
			second: {
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated:east",
				expected: "aiki:{acme}:workflow:user:billing:1.0.0:dedicated%3Aeast",
			},
		},
	];
	for (const { label, first, second } of collisions) {
		test(`distinguishes delimiters in ${label}`, () => {
			const firstQueueName = getWorkflowQueueName({ namespaceId: "acme", source: "user", ...first });
			const secondQueueName = getWorkflowQueueName({ namespaceId: "acme", source: "user", ...second });

			expect(firstQueueName).toBe(first.expected);
			expect(secondQueueName).toBe(second.expected);
			expect(firstQueueName).not.toBe(secondQueueName);
		});
	}

	const escapedFields = {
		namespaceId: {
			colon: "aiki:{a%3Ab}:workflow:user:billing:1.0.0:dedicated",
			escapedColon: "aiki:{a%253Ab}:workflow:user:billing:1.0.0:dedicated",
		},
		name: {
			colon: "aiki:{acme}:workflow:user:a%3Ab:1.0.0:dedicated",
			escapedColon: "aiki:{acme}:workflow:user:a%253Ab:1.0.0:dedicated",
		},
		versionId: {
			colon: "aiki:{acme}:workflow:user:billing:a%3Ab:dedicated",
			escapedColon: "aiki:{acme}:workflow:user:billing:a%253Ab:dedicated",
		},
		pool: {
			colon: "aiki:{acme}:workflow:user:billing:1.0.0:a%3Ab",
			escapedColon: "aiki:{acme}:workflow:user:billing:1.0.0:a%253Ab",
		},
	};
	for (const [field, expected] of Object.entries(escapedFields)) {
		test(`distinguishes literal escape sequences in ${field}`, () => {
			const workflow = {
				namespaceId: "acme",
				source: "user" as const,
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated",
			};
			expect({
				colon: getWorkflowQueueName({ ...workflow, [field]: "a:b" }),
				escapedColon: getWorkflowQueueName({ ...workflow, [field]: "a%3Ab" }),
			}).toEqual(expected);
		});
	}
});

describe("getWorkflowQueueNames", () => {
	const workflows: NonEmptyArray<WorkflowMeta> = [
		{
			source: "user",
			name: "billing:v2" as WorkflowName,
			versionId: "1.0.0" as WorkflowVersionId,
		},
	];
	for (const pools of [undefined, []]) {
		test(`builds one queue per workflow when pools are ${JSON.stringify(pools)}`, () => {
			expect(getWorkflowQueueNames("acme", workflows, pools)).toEqual(["aiki:{acme}:workflow:user:billing%3Av2:1.0.0"]);
		});
	}
	test("builds one queue per workflow and pool", () => {
		expect(getWorkflowQueueNames("acme", workflows, ["dedicated:east", "shared"])).toEqual([
			"aiki:{acme}:workflow:user:billing%3Av2:1.0.0:dedicated%3Aeast",
			"aiki:{acme}:workflow:user:billing%3Av2:1.0.0:shared",
		]);
	});
});
