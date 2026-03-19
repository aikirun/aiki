export const USER_STATUSES = ["active", "suspended", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
