import { workflowRunContract } from "./workflow-run/procedure";

export const contract = {
	workflowRun: workflowRunContract,
};

export type Contract = typeof contract;
