export const NAMESPACE_STATUSES = ["active", "suspended", "deleted"] as const;
export type NamespaceStatus = (typeof NAMESPACE_STATUSES)[number];
