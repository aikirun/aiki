import { scheduleContract } from "./procedure/schedule";
import { taskContract } from "./procedure/task";
import { workflowContract } from "./procedure/workflow";
import { workflowRunContract } from "./procedure/workflow-run";

export const namespaceAuthedContract = {
	schedule: scheduleContract,
	task: taskContract,
	workflow: workflowContract,
	workflowRun: workflowRunContract,
};

export type NamespaceAuthedContract = typeof namespaceAuthedContract;
