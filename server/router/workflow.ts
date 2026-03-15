import type { WorkflowService } from "server/service/workflow";

import { namespaceAuthedImplementer } from "./implementer";

export function createWorkflowRouter(workflowService: WorkflowService) {
	const os = namespaceAuthedImplementer.workflow;

	const listV1 = os.listV1.handler(async ({ input: request, context }) => {
		return workflowService.listWorkflowsWithStats(context, request);
	});

	const listVersionsV1 = os.listVersionsV1.handler(async ({ input: request, context }) => {
		return workflowService.listWorkflowVersionsWithStats(context, request);
	});

	const getStatsV1 = os.getStatsV1.handler(async ({ input: request, context }) => {
		return workflowService.getWorkflowStats(context, request);
	});

	return os.router({
		getStatsV1,
		listV1,
		listVersionsV1,
	});
}
