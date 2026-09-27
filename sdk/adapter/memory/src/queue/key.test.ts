import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type { WorkflowMeta, WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import { getWorkflowQueueName, getWorkflowQueueNames } from "./key";
import { describe, expect, test } from "bun:test";

describe("getWorkflowQueueName", () => {
	test("builds the queue name from the namespace, workflow and pool", () => {
		expect(getWorkflowQueueName({ namespaceId: "acme", source: "user", name: "billing", versionId: "1.0.0" })).toBe(
			"acme:user:billing:1.0.0"
		);
		expect(
			getWorkflowQueueName({
				namespaceId: "acme",
				source: "user",
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated",
			})
		).toBe("acme:user:billing:1.0.0:dedicated");
	});

	const collisions = [
		{
			label: "name and version",
			first: { name: "billing:v2", versionId: "1.0.0", expected: "acme:user:billing%3Av2:1.0.0" },
			second: { name: "billing", versionId: "v2:1.0.0", expected: "acme:user:billing:v2%3A1.0.0" },
		},
		{
			label: "version and pool",
			first: { name: "billing", versionId: "1.0.0:dedicated", expected: "acme:user:billing:1.0.0%3Adedicated" },
			second: { name: "billing", versionId: "1.0.0", pool: "dedicated", expected: "acme:user:billing:1.0.0:dedicated" },
		},
		{
			label: "colons within pools",
			first: {
				name: "billing",
				versionId: "1.0.0:dedicated",
				pool: "east",
				expected: "acme:user:billing:1.0.0%3Adedicated:east",
			},
			second: {
				name: "billing",
				versionId: "1.0.0",
				pool: "dedicated:east",
				expected: "acme:user:billing:1.0.0:dedicated%3Aeast",
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
			colon: "a%3Ab:user:billing:1.0.0:dedicated",
			escapedColon: "a%253Ab:user:billing:1.0.0:dedicated",
		},
		name: {
			colon: "acme:user:a%3Ab:1.0.0:dedicated",
			escapedColon: "acme:user:a%253Ab:1.0.0:dedicated",
		},
		versionId: {
			colon: "acme:user:billing:a%3Ab:dedicated",
			escapedColon: "acme:user:billing:a%253Ab:dedicated",
		},
		pool: {
			colon: "acme:user:billing:1.0.0:a%3Ab",
			escapedColon: "acme:user:billing:1.0.0:a%253Ab",
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
			expect(getWorkflowQueueNames("acme", workflows, pools)).toEqual(["acme:user:billing%3Av2:1.0.0"]);
		});
	}

	test("builds one queue per workflow and pool", () => {
		expect(getWorkflowQueueNames("acme", workflows, ["dedicated:east", "shared"])).toEqual([
			"acme:user:billing%3Av2:1.0.0:dedicated%3Aeast",
			"acme:user:billing%3Av2:1.0.0:shared",
		]);
	});
});
