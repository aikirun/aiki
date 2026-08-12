import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import { workflowRegistry } from "./registry";
import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

const orders = workflow({ name: "orders" });
const ordersV1 = orders.v("v1", { handler: async () => {} });
const ordersV2 = orders.v("v2", { handler: async () => {} });

const payments = workflow({ name: "payments" });
const paymentsV1 = payments.v("v1", { handler: async () => {} });

// A platform workflow whose name and versionId collide with the user's orders workflow.
const systemOrdersV1 = workflow({ name: "orders" }).v("v1", { handler: async () => {} });

describe("workflowRegistry", () => {
	test("starts empty", () => {
		const registry = workflowRegistry();
		expect(registry.getAll()).toEqual([]);
	});

	test("add stores a workflow retrievable by source, name and versionId", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);

		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(ordersV1);
	});

	test("add throws on duplicate source + name + versionId", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);

		expect(() => registry.add("user", ordersV1)).toThrow(
			'Workflow "orders:v1" with source "user" is already registered'
		);
	});

	test("add accepts the same name and versionId under a different source", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);

		expect(() => registry.add("system", systemOrdersV1)).not.toThrow();
	});

	test("get resolves colliding name and versionId to the workflow of the requested source", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("system", systemOrdersV1);

		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(ordersV1);
		expect(registry.get("system", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(systemOrdersV1);
	});

	test("get returns undefined when only the other source holds the workflow", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);

		expect(registry.get("system", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
	});

	test("add allows same name with different versionId", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("user", ordersV2);

		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(ordersV1);
		expect(registry.get("user", "orders" as WorkflowName, "v2" as WorkflowVersionId)).toBe(ordersV2);
	});

	test("addMany registers multiple workflows", () => {
		const registry = workflowRegistry();
		registry.addMany("user", [ordersV1, paymentsV1]);

		const all = registry.getAll();
		expect(all).toContainValues([
			{ source: "user", workflow: ordersV1 },
			{ source: "user", workflow: paymentsV1 },
		]);
	});

	test("remove deletes a workflow", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);
		registry.remove("user", ordersV1);

		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
	});

	test("remove leaves the colliding workflow of the other source registered", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("system", systemOrdersV1);
		registry.remove("user", ordersV1);

		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
		expect(registry.get("system", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(systemOrdersV1);
	});

	test("remove is a no-op for unknown workflow", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1);
		registry.remove("user", paymentsV1);

		expect(registry.getAll()).toHaveLength(1);
	});

	test("removeMany deletes multiple workflows", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("user", paymentsV1);
		registry.removeMany("user", [ordersV1, paymentsV1]);

		expect(registry.getAll()).toEqual([]);
	});

	test("removeAll clears every source", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("system", systemOrdersV1);
		registry.removeAll();

		expect(registry.getAll()).toEqual([]);
	});

	test("get returns undefined for missing workflow", () => {
		const registry = workflowRegistry();
		expect(registry.get("user", "orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
	});

	test("getAll returns workflows across names and sources", () => {
		const registry = workflowRegistry();
		registry.add("user", ordersV1).add("user", ordersV2).add("system", systemOrdersV1);

		const all = registry.getAll();
		expect(all).toContainValues([
			{ source: "user", workflow: ordersV1 },
			{ source: "user", workflow: ordersV2 },
			{ source: "system", workflow: systemOrdersV1 },
		]);
	});

	test("methods return the registry for chaining", () => {
		const registry = workflowRegistry();

		const result = registry
			.add("user", ordersV1)
			.addMany("user", [paymentsV1])
			.remove("user", ordersV1)
			.removeMany("user", [paymentsV1])
			.removeAll();
		expect(result).toBe(registry);
	});
});
