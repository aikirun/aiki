import { ulid } from "ulidx";

import { type SeedUserDeps, type SignedInUser, seedSignedInUser } from "./user";

/** An organization whose owner has it active, with one namespace the owner created. */
export async function seedOrganizationWithNamespace(deps: SeedUserDeps) {
	const owner = await seedSignedInUser(deps);
	const organization = await owner.callAuth("/organization/create", {
		name: "Acme",
		slug: `acme-${ulid().toLowerCase()}`,
		type: "personal",
	});
	const organizationId = organization.body?.id as string;
	await owner.callAuth("/organization/set-active", { organizationId });
	const created = await owner.callDashboard("/namespace/createV1", { name: "main" });
	const namespaceId = (created.output as { namespace: { id: string } }).namespace.id;
	return { owner, organizationId, namespaceId };
}

/** A new user who accepted the owner's invitation with the given role and has the organization active. */
export async function seedOrganizationMember(
	deps: SeedUserDeps,
	params: { owner: SignedInUser; organizationId: string; role: "admin" | "member" }
): Promise<SignedInUser> {
	const { owner, organizationId, role } = params;
	const invitee = await seedSignedInUser(deps);
	const invitation = await owner.callAuth("/organization/invite-member", {
		email: invitee.email,
		role,
		organizationId,
	});
	await invitee.callAuth("/organization/accept-invitation", { invitationId: invitation.body?.id });
	await invitee.callAuth("/organization/set-active", { organizationId });
	return invitee;
}

/** An invitation the owner sent that nobody has answered. */
export async function seedPendingInvitation(params: {
	owner: SignedInUser;
	organizationId: string;
	email: string;
	role: "admin" | "member";
}) {
	const { owner, organizationId, email, role } = params;
	const invitation = await owner.callAuth("/organization/invite-member", { email, role, organizationId });
	const invitationId = invitation.body?.id;
	if (typeof invitationId !== "string") {
		throw new Error(`The invitation was not created: ${invitation.status}`);
	}
	return { invitationId };
}
