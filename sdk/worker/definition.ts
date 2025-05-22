import { delay } from "@std/async/delay";
import type { Client } from "../client/definition.ts";
import {
  initWorkflowRegistry,
  type WorkflowRegistry,
} from "../workflow/registry.ts";
import type { WorkflowRunSubscriber } from "../workflow/run/subscriber.ts";
import { initWorkflowRun } from "../workflow/run/definition.ts";
import type { WorkflowRunRepository } from "../workflow/run/repository.ts";

export async function worker(
  client: Client,
  params: WorkerParams,
): Promise<Worker> {
  const registry = initWorkflowRegistry();
  const workflowRunSubscriber = await client.getWorkflowRunSubscriber();
  return Promise.resolve(
    new WorkerImpl(
      registry,
      client.workflowRunRepository,
      workflowRunSubscriber,
      params,
    ),
  );
}

export interface WorkerParams {
  id?: string;
}

export interface Worker {
  id: string;
  registry: WorkflowRegistry;
  start: () => Promise<void>;
}

class WorkerImpl implements Worker {
  public readonly id: string;

  constructor(
    public readonly registry: WorkflowRegistry,
    private readonly workflowRunRepository: WorkflowRunRepository,
    private readonly workflowRunSubscriber: WorkflowRunSubscriber,
    private readonly params: WorkerParams, // TODO: params is unused
  ) {
    // TODO use a guid
    this.id = params.id ?? "random-id";
  }

  public async start(): Promise<void> {
    while (true) {
      // TODO choose proper default
      await delay(100);

      const workflowRunRow = await this.workflowRunSubscriber._next();
      if (!workflowRunRow) {
        continue;
      }

      // TODO: no need to execute if workflow result is in final state or paused state

      const workflow = this.registry._getByPath(workflowRunRow.workflow.path);
      if (!workflow) {
        // TODO log error that there is no workflow for path
        // deno-lint-ignore no-console
        console.log(`No workflow for path: ${workflowRunRow.workflow.path}`);
        continue;
      }

      const workflowRun = await initWorkflowRun({
        repository: this.workflowRunRepository,
        workflowRunRow,
      });
      await workflow._execute({ workflowRun });
    }
  }
}
