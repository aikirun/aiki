import { namespaceAuthedImplementer } from "./implementer";
import type { WorkflowService } from "../service/workflow";

export function createWorkflowRouter(workflowService: WorkflowService) {
	const os = namespaceAuthedImplementer.workflow;

	return os.router({
		listV1: os.listV1.handler(async ({ input: request, context }) => {
			return workflowService.listWorkflowsWithStats(context, request);
		}),

		listVersionsV1: os.listVersionsV1.handler(async ({ input: request, context }) => {
			return workflowService.listWorkflowVersionsWithStats(context, request);
		}),

		getStatsV1: os.getStatsV1.handler(async ({ input: request, context }) => {
			return workflowService.getWorkflowStats(context, request);
		}),
	});
}
