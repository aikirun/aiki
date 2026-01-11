import { baseImplementer } from "./base";
import { workflowRouter } from "./workflow";
import { workflowRunRouter } from "./workflow-run";

export const router = baseImplementer.router({
	workflow: workflowRouter,
	workflowRun: workflowRunRouter,
});
