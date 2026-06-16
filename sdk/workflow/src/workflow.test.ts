import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowName, WorkflowVersionId } from "@aikirun/types/workflow";

import { workflow } from "./workflow";
import { describe, expect, test } from "bun:test";

describe("workflow", () => {
	test("has the given name", () => {
		const orders = workflow({ name: "orders" });
		expect(orders.name).toBe("orders" as WorkflowName);
	});

	test("v creates a version with the given versionId", () => {
		const orders = workflow({ name: "orders" });
		const ordersV1 = orders.v("1.0.0", { handler: async () => {} });

		expect(ordersV1.name).toBe("orders" as WorkflowName);
		expect(ordersV1.versionId).toBe("1.0.0" as WorkflowVersionId);
	});

	test("v throws on duplicate versionId", () => {
		const orders = workflow({ name: "orders" });
		orders.v("1.0.0", { handler: async () => {} });

		expect(() => orders.v("1.0.0", { handler: async () => {} })).toThrow('Workflow "orders:1.0.0" already exists');
	});

	test("v allows multiple versions", () => {
		const orders = workflow({ name: "orders" });
		const ordersV1 = orders.v("1.0.0", { handler: async () => {} });
		const ordersV2 = orders.v("2.0.0", { handler: async () => {} });

		expect(ordersV1.name).toBe("orders" as WorkflowName);
		expect(ordersV1.versionId).toBe("1.0.0" as WorkflowVersionId);
		expect(ordersV2.name).toBe("orders" as WorkflowName);
		expect(ordersV2.versionId).toBe("2.0.0" as WorkflowVersionId);
	});

	test("getAllVersions returns all registered versions", () => {
		const orders = workflow({ name: "orders" });
		const ordersV1 = orders.v("1.0.0", { handler: async () => {} });
		const ordersV2 = orders.v("2.0.0", { handler: async () => {} });

		const all = orders[INTERNAL].getAllVersions();
		expect(all).toHaveLength(2);
		expect(all).toContainValues([ordersV1, ordersV2]);
	});

	test("getVersion returns a version by id", () => {
		const orders = workflow({ name: "orders" });
		const ordersV1 = orders.v("1.0.0", { handler: async () => {} });

		expect(orders[INTERNAL].getVersion("1.0.0" as WorkflowVersionId)).toBe(ordersV1);
	});

	test("getVersion returns undefined for missing versionId", () => {
		const orders = workflow({ name: "orders" });

		expect(orders[INTERNAL].getVersion("1.0.0" as WorkflowVersionId)).toBeUndefined();
	});
});
