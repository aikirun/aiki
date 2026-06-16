import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import { workflowRegistry } from "./registry";
import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

const orders = workflow({ name: "orders" });
const ordersV1 = orders.v("v1", { handler: async () => {} });
const ordersV2 = orders.v("v2", { handler: async () => {} });

const payments = workflow({ name: "payments" });
const paymentsV1 = payments.v("v1", { handler: async () => {} });

describe("workflowRegistry", () => {
	test("starts empty", () => {
		const registry = workflowRegistry();
		expect(registry.getAll()).toEqual([]);
	});

	test("add stores a workflow retrievable by name and versionId", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1);

		expect(registry.get("orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(ordersV1);
	});

	test("add throws on duplicate name + versionId", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1);

		expect(() => registry.add(ordersV1)).toThrow('Workflow "orders:v1" is already registered');
	});

	test("add allows same name with different versionId", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1).add(ordersV2);

		expect(registry.get("orders" as WorkflowName, "v1" as WorkflowVersionId)).toBe(ordersV1);
		expect(registry.get("orders" as WorkflowName, "v2" as WorkflowVersionId)).toBe(ordersV2);
	});

	test("addMany registers multiple workflows", () => {
		const registry = workflowRegistry();
		registry.addMany([ordersV1, paymentsV1]);

		const all = registry.getAll();
		expect(all).toHaveLength(2);
		expect(all).toContainValues([ordersV1, paymentsV1]);
	});

	test("remove deletes a workflow", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1);
		registry.remove(ordersV1);

		expect(registry.get("orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
	});

	test("remove is a no-op for unknown workflow", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1);
		registry.remove(paymentsV1);

		expect(registry.getAll()).toHaveLength(1);
	});

	test("removeMany deletes multiple workflows", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1).add(paymentsV1);
		registry.removeMany([ordersV1, paymentsV1]);

		expect(registry.getAll()).toEqual([]);
	});

	test("removeAll clears the registry", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1).add(paymentsV1);
		registry.removeAll();

		expect(registry.getAll()).toEqual([]);
	});

	test("get returns undefined for missing workflow", () => {
		const registry = workflowRegistry();
		expect(registry.get("orders" as WorkflowName, "v1" as WorkflowVersionId)).toBeUndefined();
	});

	test("getAll returns workflows across names", () => {
		const registry = workflowRegistry();
		registry.add(ordersV1).add(ordersV2).add(paymentsV1);

		const all = registry.getAll();
		expect(all).toHaveLength(3);
		expect(all).toContainValues([ordersV1, ordersV2, paymentsV1]);
	});

	test("methods return the registry for chaining", () => {
		const registry = workflowRegistry();

		const result = registry.add(ordersV1).addMany([paymentsV1]).remove(ordersV1).removeMany([paymentsV1]).removeAll();
		expect(result).toBe(registry);
	});
});
