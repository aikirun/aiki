import { scheduleContract } from "./procedure/schedule";
import { workflowContract } from "./procedure/workflow";
import { workflowRunContract } from "./procedure/workflow-run";

export const authedContract = {
	schedule: scheduleContract,
	workflow: workflowContract,
	workflowRun: workflowRunContract,
};

export type AuthedContract = typeof authedContract;
