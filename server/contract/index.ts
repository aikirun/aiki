import { scheduleContract } from "./schedule/procedure";
import { workflowContract } from "./workflow/procedure";
import { workflowRunContract } from "./workflow-run/procedure";

export const contract = {
	schedule: scheduleContract,
	workflow: workflowContract,
	workflowRun: workflowRunContract,
};

export type Contract = typeof contract;
