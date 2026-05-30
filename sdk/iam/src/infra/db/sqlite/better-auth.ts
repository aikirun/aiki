import {
	account,
	namespace,
	namespaceMember,
	organization,
	organizationInvitation,
	organizationMember,
	session,
	user,
	verification,
} from "./schema";

export const sqliteBetterAuthSchema = {
	user,
	session,
	account,
	verification,
	organization,
	organization_member: organizationMember,
	organization_invitation: organizationInvitation,
	namespace,
	namespace_member: namespaceMember,
};
