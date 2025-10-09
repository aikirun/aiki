import { workflowRunContract } from "./workflow-run/procedure.ts";

export const contract = {
	workflowRun: workflowRunContract,
};

export type Contract = typeof contract;
