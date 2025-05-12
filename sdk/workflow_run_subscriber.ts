import type { WorkflowRunRepository, WorkflowRunRow } from "./workflow_run_repository.ts";

export function initWorkflowRunSubscriber(
    params: {
        repository: WorkflowRunRepository
    }
): Promise<WorkflowRunSubscriber> {
    return Promise.resolve(new WorkflowRunSubscriberImpl(params.repository));
}

export interface WorkflowRunSubscriber {
    _next: () => Promise<WorkflowRunRow<unknown, unknown> | null>;
}

export class WorkflowRunSubscriberImpl implements WorkflowRunSubscriber {
    constructor(private readonly repository: WorkflowRunRepository) {}

    // TODO: implement
    public _next(): Promise<WorkflowRunRow<unknown, unknown> | null> {
        return Promise.resolve(null);
    }
}