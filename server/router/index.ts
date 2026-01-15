import { baseImplementer } from "./base";
import { scheduleRouter } from "./schedule";
import { workflowRouter } from "./workflow";
import { workflowRunRouter } from "./workflow-run";

export const router = baseImplementer.router({
	schedule: scheduleRouter,
	workflow: workflowRouter,
	workflowRun: workflowRunRouter,
});
