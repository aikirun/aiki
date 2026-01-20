export const NAMESPACE_STATUSES = ["active", "suspended", "deleted"] as const;
export type NameSpaceStatus = (typeof NAMESPACE_STATUSES)[number];

export const NAMESPACE_ROLES = ["admin", "member", "viewer"] as const;
export type NamespaceRole = (typeof NAMESPACE_ROLES)[number];
