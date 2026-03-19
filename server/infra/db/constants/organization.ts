export const ORGANIZATION_STATUSES = ["active", "suspended", "deleted"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_TYPES = ["personal", "team"] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const ORGANIZATION_INVITATION_STATUSES = ["pending", "accepted", "rejected", "expired", "cancelled"] as const;
export type OrganizationInvitationStatus = (typeof ORGANIZATION_INVITATION_STATUSES)[number];
