import { initWorkflowRun, WorkflowRun } from "../workflow-run/index.ts";
import { Workflow, WorkflowExecuteParams, WorkflowParams, WorkflowRunParams } from "./type.ts";
import { AikiClient } from "../client/index.ts";

export class WorkflowImpl<Payload, Result> implements Workflow<Payload, Result> {
	public readonly path: string;
	public readonly _execute: (params: WorkflowExecuteParams<Payload, Result>) => Promise<Result>;

	constructor(private readonly params: WorkflowParams<Payload, Result>) {
		this.path = `${params.name}/${params.version}`;
		this._execute = params.run;
	}

	public async run(
		client: AikiClient, 
		runParams: WorkflowRunParams<Payload>
	): Promise<WorkflowRun<Payload, Result>> {
		const workflowRunRow = await client.workflowRunRepository.create(this, runParams);
		return initWorkflowRun({
			client,
			workflow: this,
			runParams,
			workflowRunRow
		});
	}
}
