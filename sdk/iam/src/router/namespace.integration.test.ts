import { describe, expect, test } from "vitest";

import { createIamHarness } from "../testing/harness";
import { seedOrganizationMember, seedOrganizationWithNamespace } from "../testing/seed/organization";

const withHarness = createIamHarness();

describe("namespace setActiveV1", () => {
	test("lets an organization admin use a namespace they are not a member of", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const admin = await seedOrganizationMember(deps, { owner, organizationId, role: "admin" });

			const selected = await admin.callDashboard("/namespace/setActiveV1", { id: namespaceId });

			expect(selected).toEqual({ status: 200, output: undefined });
			expect(await admin.authorizeApiRequest()).toEqual({ organizationId, namespaceId, userId: admin.userId });
		}));

	test("lets a viewer of a namespace use it", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const viewer = await seedOrganizationMember(deps, { owner, organizationId, role: "member" });
			await owner.callDashboard("/namespace/setMembershipV1", {
				id: namespaceId,
				members: [{ userId: viewer.userId, role: "viewer" }],
			});

			const selected = await viewer.callDashboard("/namespace/setActiveV1", { id: namespaceId });

			expect(selected).toEqual({ status: 200, output: undefined });
			expect(await viewer.authorizeApiRequest()).toEqual({ organizationId, namespaceId, userId: viewer.userId });
		}));

	test("refuses an organization member who is not a member of the namespace", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const member = await seedOrganizationMember(deps, { owner, organizationId, role: "member" });

			const selected = await member.callDashboard("/namespace/setActiveV1", { id: namespaceId });

			expect(selected).toEqual({ status: 403, error: "Not a member of this namespace" });
			await expect(member.authorizeApiRequest()).rejects.toThrow("No active namespace selected");
		}));

	test("refuses a namespace of another organization", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const admin = await seedOrganizationMember(deps, { owner, organizationId, role: "admin" });
			const otherOrganization = await seedOrganizationWithNamespace(deps);

			const selected = await admin.callDashboard("/namespace/setActiveV1", { id: otherOrganization.namespaceId });

			expect(selected).toEqual({ status: 404, error: "Namespace not found" });
			await expect(admin.authorizeApiRequest()).rejects.toThrow("No active namespace selected");
		}));
});
