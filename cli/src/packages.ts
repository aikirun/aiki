export const PACKAGES = ["server", "iam"] as const;
export type Package = (typeof PACKAGES)[number];
