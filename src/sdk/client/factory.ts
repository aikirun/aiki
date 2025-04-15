import { initWorkflowRunRepository } from "../workflow-run/index.ts";
import { AikiClientParams, AikiClient } from "./type.ts";

export function aiki(_params: AikiClientParams): Promise<AikiClient> {
    return Promise.resolve({
        workflowRunRepository: initWorkflowRunRepository()
    });
}