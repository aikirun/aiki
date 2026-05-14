export const WORKFLOW_RUN_OUTBOX_STATUSES = ["pending", "published", "claimed"] as const;
export type WorkflowRunOutboxStatus = (typeof WORKFLOW_RUN_OUTBOX_STATUSES)[number];
