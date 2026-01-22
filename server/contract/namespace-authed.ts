import { apiKeyContract } from "./procedure/api-key";
import { scheduleContract } from "./procedure/schedule";
import { workflowContract } from "./procedure/workflow";
import { workflowRunContract } from "./procedure/workflow-run";

export const namespaceAuthedContract = {
	apiKey: apiKeyContract,
	schedule: scheduleContract,
	workflow: workflowContract,
	workflowRun: workflowRunContract,
};

export type NamespaceAuthedContract = typeof namespaceAuthedContract;
