export const STATE_TRANSITION_TYPES = ["workflow_run", "task", "schedule"] as const;
export type StateTransitionType = (typeof STATE_TRANSITION_TYPES)[number];
