import { scheduleRouter } from "./authed/schedule";
import { workflowRouter } from "./authed/workflow";
import { workflowRunRouter } from "./authed/workflow-run";
import { authedImplementer, publicImplementer } from "./implementer";
import { healthRouter } from "./public/health";

export const publicRouter = publicImplementer.router({
	health: healthRouter,
});

export const authedRouter = authedImplementer.router({
	schedule: scheduleRouter,
	workflow: workflowRouter,
	workflowRun: workflowRunRouter,
});
