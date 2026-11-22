import { describe, expect, test } from "vitest";

import { createIamHarness } from "../testing/harness";
import {
	seedOrganizationMember,
	seedOrganizationWithNamespace,
	seedRemovedNamespace,
} from "../testing/seed/organization";
import type { SignedInUser } from "../testing/seed/user";

const withHarness = createIamHarness();

describe("namespace setActiveV1", () => {
	test("lets an organization admin use a namespace they are not a member of", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const admin = await seedOrganizationMember(deps, { owner, organizationId, role: "admin" });

			await expect(admin.dashboard.namespace.setActiveV1({ id: namespaceId })).resolves.toBeUndefined();
			expect(await admin.authorizeApiRequest()).toEqual({ organizationId, namespaceId, userId: admin.userId });
		}));

	test("lets a viewer of a namespace use it", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const viewer = await seedOrganizationMember(deps, { owner, organizationId, role: "member" });
			await owner.dashboard.namespace.setMembershipV1({
				id: namespaceId,
				members: [{ userId: viewer.userId, role: "viewer" }],
			});

			await expect(viewer.dashboard.namespace.setActiveV1({ id: namespaceId })).resolves.toBeUndefined();
			expect(await viewer.authorizeApiRequest()).toEqual({ organizationId, namespaceId, userId: viewer.userId });
		}));

	test("refuses an organization member who is not a member of the namespace", () =>
		withHarness(async (deps) => {
			const { owner, organizationId, namespaceId } = await seedOrganizationWithNamespace(deps);
			const member = await seedOrganizationMember(deps, { owner, organizationId, role: "member" });

			await expect(member.dashboard.namespace.setActiveV1({ id: namespaceId })).rejects.toMatchObject({
				code: "FORBIDDEN",
				status: 403,
				message: "Not a member of this namespace",
			});
			await expect(member.authorizeApiRequest()).rejects.toThrow("No active namespace selected");
		}));

	test("refuses a namespace of another organization", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const admin = await seedOrganizationMember(deps, { owner, organizationId, role: "admin" });
			const otherOrganization = await seedOrganizationWithNamespace(deps);

			await expect(admin.dashboard.namespace.setActiveV1({ id: otherOrganization.namespaceId })).rejects.toMatchObject({
				code: "NOT_FOUND",
				status: 404,
				message: "Namespace not found",
			});
			await expect(admin.authorizeApiRequest()).rejects.toThrow("No active namespace selected");
		}));
});

describe("a removed namespace", () => {
	const callByRoute = {
		deleteV1: (owner: SignedInUser, id: string) => owner.dashboard.namespace.deleteV1({ id }),
		setActiveV1: (owner: SignedInUser, id: string) => owner.dashboard.namespace.setActiveV1({ id }),
		setMembershipV1: (owner: SignedInUser, id: string) =>
			owner.dashboard.namespace.setMembershipV1({ id, members: [{ userId: owner.userId, role: "admin" }] }),
		removeMembershipV1: (owner: SignedInUser, id: string) =>
			owner.dashboard.namespace.removeMembershipV1({ id, userId: owner.userId }),
		listMembersV1: (owner: SignedInUser, id: string) => owner.dashboard.namespace.listMembersV1({ id }),
	};

	for (const [route, callRoute] of Object.entries(callByRoute)) {
		test(`is not found by ${route}`, () =>
			withHarness(async (deps) => {
				const { owner, removedNamespaceId } = await seedRemovedNamespace(deps);

				await expect(callRoute(owner, removedNamespaceId)).rejects.toMatchObject({
					code: "NOT_FOUND",
					status: 404,
					message: "Namespace not found",
				});
			}));
	}
});
