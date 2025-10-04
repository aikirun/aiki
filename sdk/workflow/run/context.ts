import type { WorkflowRun } from "./workflow-run.ts";

export interface WorkflowRunContext<Payload, Result> {
	workflowRun: Omit<WorkflowRun<Payload, Result>, "params">;
}
