import { scheduleRouter } from "./authed/schedule";
import { workflowRouter } from "./authed/workflow";
import { workflowRunRouter } from "./authed/workflow-run";
import { authedImplementer, publicImplementer } from "./implementer";

export const publicRouter = publicImplementer.router({});

export const authedRouter = authedImplementer.router({
	schedule: scheduleRouter,
	workflow: workflowRouter,
	workflowRun: workflowRunRouter,
});
