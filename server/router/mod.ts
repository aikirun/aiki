import { baseImplementer } from "./base.ts";
import { workflowRunRouter } from "./workflow-run.ts";

export const router = baseImplementer.router({
	workflowRun: workflowRunRouter,
});
