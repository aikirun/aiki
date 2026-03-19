export const WORKFLOW_RUN_OUTBOX_STATUSES = ["pending", "published"] as const;
export type WorkflowRunOutboxStatus = (typeof WORKFLOW_RUN_OUTBOX_STATUSES)[number];
