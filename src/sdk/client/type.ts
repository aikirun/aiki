import { WorkflowRunRepository } from "../workflow-run/index.ts";

export interface AikiClientParams {
    url: string;
}

export interface AikiClient {
    workflowRunRepository: WorkflowRunRepository;
}