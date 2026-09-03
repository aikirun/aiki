export const CHILD_WORKFLOW_RUN_WAIT_STATUSES = ["completed", "timeout"] as const;
export type ChildWorkflowRunWaitStatus = (typeof CHILD_WORKFLOW_RUN_WAIT_STATUSES)[number];
