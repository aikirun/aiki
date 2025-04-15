import { AikiClient } from "../sdk/client/index.ts";
import { initWorkflowRun } from "../sdk/workflow-run/index.ts";
import { morningRoutingWorkflowV1, morningRoutingWorkflowV2, morningRoutingWorkflowV3 } from "../sdk/workflow/index.ts";

// TODO: how to locally store the available workflows?
const workflowsByPath = {
	[morningRoutingWorkflowV1.path]: morningRoutingWorkflowV1,
	[morningRoutingWorkflowV2.path]: morningRoutingWorkflowV2,
	[morningRoutingWorkflowV3.path]: morningRoutingWorkflowV3,
};

export interface WorkflowExecutorParams {
	client: AikiClient;
}

export async function workflowExecutor({client}: WorkflowExecutorParams) {
	// TODO:
	// find workflows which should be run

	const workflowRunId = "1";
	const workflowPath = "dummy-workflow/1.0.0";

	const workflow = workflowsByPath[workflowPath] as typeof morningRoutingWorkflowV1 | undefined;
	if (workflow === undefined) {
		throw Error(`No workflow on path ${workflowPath}`);
	}

	const workflowRun = initWorkflowRun({
		client,
		workflow,
		runParams: {
			payload: {
				a: "jingle bells",
				b: 10
			}
		},
		workflowRunRow: {
			id: workflowRunId,
			subTasksRunResult: {},
			subWorkflowsRunResult: {}
		}
	});

	try {
		await workflow._execute({workflowRun});
	} catch (_error) {
		// TODO: if error is task completion, move on
	}
}