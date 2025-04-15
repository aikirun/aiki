import { AikiClient } from "../client/index.ts";
import { Workflow, WorkflowRunParams } from "../workflow/index.ts";
import { WorkflowRunRepositoryImpl } from "./repository.ts";
import { WorkflowRunImpl } from "./service.ts";
import { WorkflowRun, WorkflowRunRepository, WorkflowRunRow } from "./type.ts";

export function initWorkflowRun<Payload, Result>(
    params: {
        client: AikiClient;
        workflow: Workflow<Payload, Result>;
        runParams: WorkflowRunParams<Payload>;
        workflowRunRow: WorkflowRunRow
    }
): WorkflowRun<Payload, Result> {
    return new WorkflowRunImpl(
        params.client,
        params.workflow,
        params.runParams,
        params.workflowRunRow
    );
}

export function initWorkflowRunRepository(): WorkflowRunRepository {
    return new WorkflowRunRepositoryImpl();
}