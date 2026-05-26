export const API_KEY_STATUSES = ["active", "revoked", "expired"] as const;
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];
