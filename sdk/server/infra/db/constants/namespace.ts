export const NAMESPACE_STATUSES = ["active", "suspended", "deleted"] as const;
export type NameSpaceStatus = (typeof NAMESPACE_STATUSES)[number];
