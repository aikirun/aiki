import { delay } from "@std/async/delay";
import { type WorkflowRepository, WorkflowRepositoryImpl } from "./workflow_repository.ts";
import { initWorkflowRun } from "./workflow_run.ts";
import { intiWorkflowRunRepository, type WorkflowRunRepository } from "./workflow_run_repository.ts";
import { initWorkflowRunSubscriber, type WorkflowRunSubscriber } from "./workflow_run_subscriber.ts";

export interface AikiClientParams {
    url: string;
}

export interface AikiClient {
    workflow: WorkflowRepository;
    workflowRun: WorkflowRunRepository;
    listen: () => Promise<void>;
}

export async function aiki(params: AikiClientParams): Promise<AikiClient> {
    const workflowRunRepository = await intiWorkflowRunRepository();
    const workflowRunSubscriber = await initWorkflowRunSubscriber({
        repository: workflowRunRepository
    });
    return Promise.resolve(new AikiClientImpl(workflowRunRepository, workflowRunSubscriber, params));
}

export class AikiClientImpl implements AikiClient {
    public readonly workflow: WorkflowRepository;

    // TODO: params is unused
    constructor(
        public readonly workflowRun: WorkflowRunRepository,
        private readonly workflowRunSubscriber: WorkflowRunSubscriber,
        private readonly _params: AikiClientParams
    ) {
        this.workflow = new WorkflowRepositoryImpl();
    }

    public async listen(): Promise<void> {
        while (true) {
            // TODO choose proper default
            await delay(100);

            const workflowRunRow = await this.workflowRunSubscriber._next();
            if (!workflowRunRow) {
                continue;
            }

            // TODO: no need to execute if workflow result is in final state or paused state

            const workflow = this.workflow._getByPath(workflowRunRow.workflow.path);
            if (!workflow) {
                // TODO log error that there is no workflow for path
                // deno-lint-ignore no-console
                console.log(`No workflow for path: ${workflowRunRow.workflow.path}`);
                continue;
            }

            const workflowRun = await initWorkflowRun({
                repository: this.workflowRun, 
                workflowRunRow
            });
            await workflow._execute({workflowRun});
        }
    }
}
