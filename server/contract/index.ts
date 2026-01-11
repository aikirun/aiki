import { workflowContract } from "./workflow/procedure";
import { workflowRunContract } from "./workflow-run/procedure";

export const contract = {
	workflow: workflowContract,
	workflowRun: workflowRunContract,
};

export type Contract = typeof contract;
