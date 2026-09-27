import { namespaceAuthedImplementer } from "./implementer";
import type { WorkflowService } from "../service/workflow";

export function createWorkflowRouter(workflowService: WorkflowService) {
	const os = namespaceAuthedImplementer.workflow;

	return os.router({
		listV1: os.listV1.handler(async ({ input: request, context }) => {
			return workflowService.listWorkflows(context, request);
		}),

		listVersionsV1: os.listVersionsV1.handler(async ({ input: request, context }) => {
			return workflowService.listWorkflowVersions(context, request);
		}),
	});
}
