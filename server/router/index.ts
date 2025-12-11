import { baseImplementer } from "./base";
import { workflowRunRouter } from "./workflow-run";

export const router = baseImplementer.router({
	workflowRun: workflowRunRouter,
});
