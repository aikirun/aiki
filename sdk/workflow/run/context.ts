import type { WorkflowRun } from "@aiki/sdk/workflow";

export interface WorkflowRunContext<Payload, Result> {
	workflowRun: Omit<WorkflowRun<Payload, Result>, "params">;
}
