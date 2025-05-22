import type { WorkflowRunParams } from "./context.ts";
import type { WorkflowRunRepository, WorkflowRunRow } from "./repository.ts";

export function initWorkflowRunSubscriber(
	params: {
		repository: WorkflowRunRepository;
	},
): Promise<WorkflowRunSubscriber> {
	return Promise.resolve(new WorkflowRunSubscriberImpl(params.repository));
}

export interface WorkflowRunSubscriber {
	_next: () => Promise<WorkflowRunRow<unknown, unknown> | null>;
}

class WorkflowRunSubscriberImpl implements WorkflowRunSubscriber {
	constructor(private readonly repository: WorkflowRunRepository) {}

	// TODO: implement
	public _next(): Promise<WorkflowRunRow<unknown, unknown> | null> {
		// TODO: fetch from storage or queue
		return Promise.resolve({
			id: "1",
			params: {} as WorkflowRunParams<unknown>,
			result: {
				state: "queued",
			},
			workflow: {
				path: "workflow-path",
			},
			subTasksRunResult: {},
			subWorkflowsRunResult: {},
		});
	}
}
