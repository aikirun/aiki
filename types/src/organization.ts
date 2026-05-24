export type OrganizationId = string & { _brand: "organization_id" };

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export function isOrganizationRole(role: string): role is OrganizationRole {
	for (const organizationRole of ORGANIZATION_ROLES) {
		if (role === organizationRole) {
			return true;
		}
	}
	return false;
}
