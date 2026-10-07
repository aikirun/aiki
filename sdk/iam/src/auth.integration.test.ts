import { ulid } from "ulidx";
import { describe, expect, test } from "vitest";

import { createIamHarness } from "./testing/harness";
import {
	seedOrganizationMember,
	seedOrganizationWithNamespace,
	seedPendingInvitation,
} from "./testing/seed/organization";
import { seedSignedInUser } from "./testing/seed/user";

const withHarness = createIamHarness();

describe("organization invitations", () => {
	test("shows an invitation to the user it was sent to, whose email is not verified", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const invitee = await seedSignedInUser(deps);
			const { invitationId } = await seedPendingInvitation({
				owner,
				organizationId,
				email: invitee.email,
				role: "member",
			});
			expect(await invitee.readAuth("/get-session")).toEqual({
				status: 200,
				body: expect.objectContaining({ user: expect.objectContaining({ id: invitee.userId, emailVerified: false }) }),
			});

			const invitation = await invitee.readAuth(`/organization/get-invitation?id=${invitationId}`);

			expect(invitation).toEqual({
				status: 200,
				body: expect.objectContaining({
					id: invitationId,
					organizationId,
					email: invitee.email,
					role: "member",
					status: "pending",
				}),
			});
		}));

	test("lets a user whose email is not verified accept an invitation", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const invitee = await seedSignedInUser(deps);
			const { invitationId } = await seedPendingInvitation({
				owner,
				organizationId,
				email: invitee.email,
				role: "member",
			});
			expect(await invitee.readAuth("/get-session")).toEqual({
				status: 200,
				body: expect.objectContaining({ user: expect.objectContaining({ id: invitee.userId, emailVerified: false }) }),
			});

			const accepted = await invitee.callAuth("/organization/accept-invitation", { invitationId });

			expect(accepted).toEqual({
				status: 200,
				body: {
					invitation: expect.objectContaining({ id: invitationId, status: "accepted" }),
					member: expect.objectContaining({ organizationId, userId: invitee.userId, role: "member" }),
				},
			});
		}));

	test("shows an organization's invitations to its owner", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const invitedEmail = `${ulid().toLowerCase()}@example.com`;
			const { invitationId } = await seedPendingInvitation({
				owner,
				organizationId,
				email: invitedEmail,
				role: "admin",
			});

			const organization = await owner.readAuth("/organization/get-full-organization");

			expect(organization).toEqual({
				status: 200,
				body: expect.objectContaining({
					id: organizationId,
					invitations: [
						expect.objectContaining({ id: invitationId, email: invitedEmail, role: "admin", status: "pending" }),
					],
				}),
			});
		}));

	test("shows an organization's invitations to an admin", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const admin = await seedOrganizationMember(deps, { owner, organizationId, role: "admin" });
			const invitedEmail = `${ulid().toLowerCase()}@example.com`;
			const { invitationId } = await seedPendingInvitation({
				owner,
				organizationId,
				email: invitedEmail,
				role: "admin",
			});

			const organization = await admin.readAuth("/organization/get-full-organization");

			// The admin's own invitation, now accepted, is in the list too.
			expect(organization).toEqual({
				status: 200,
				body: expect.objectContaining({
					id: organizationId,
					invitations: expect.arrayContaining([
						expect.objectContaining({ id: invitationId, email: invitedEmail, role: "admin", status: "pending" }),
					]),
				}),
			});
		}));

	test("hides an organization's invitations from a member", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const member = await seedOrganizationMember(deps, { owner, organizationId, role: "member" });
			const invitedEmail = `${ulid().toLowerCase()}@example.com`;
			const { invitationId } = await seedPendingInvitation({
				owner,
				organizationId,
				email: invitedEmail,
				role: "admin",
			});
			expect(await owner.readAuth("/organization/get-full-organization")).toEqual({
				status: 200,
				body: expect.objectContaining({
					invitations: expect.arrayContaining([expect.objectContaining({ id: invitationId, status: "pending" })]),
				}),
			});

			const organization = await member.readAuth("/organization/get-full-organization");

			expect(organization).toEqual({
				status: 200,
				body: expect.objectContaining({ id: organizationId, invitations: [] }),
			});
		}));

	test("does not serve the list of an organization's invitations", () =>
		withHarness(async (deps) => {
			const { owner, organizationId } = await seedOrganizationWithNamespace(deps);
			const invitedEmail = `${ulid().toLowerCase()}@example.com`;
			await seedPendingInvitation({ owner, organizationId, email: invitedEmail, role: "member" });

			const invitations = await owner.readAuth("/organization/list-invitations");

			expect(invitations).toEqual({ status: 404, body: "Not Found" });
		}));
});
