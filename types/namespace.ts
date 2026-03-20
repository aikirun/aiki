export type NamespaceId = string & { _brand: "namespace_id" };

export const NAMESPACE_ROLES = ["admin", "member", "viewer"] as const;
export type NamespaceRole = (typeof NAMESPACE_ROLES)[number];
