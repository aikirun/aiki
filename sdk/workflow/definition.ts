import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { WorkflowRunContext, WorkflowRunParams } from "./run/context.ts";
import { initWorkflowRun, type WorkflowRun } from "./run/definition.ts";
import type { Client } from "../client/definition.ts";

export function workflow<
	Payload = undefined,
	Result = void,
>(params: WorkflowParams<Payload, Result>): Workflow<Payload, Result> {
	return new WorkflowImpl(params);
}

export interface WorkflowParams<Payload, Result> {
	name: string;
	version: string;
	run: (context: WorkflowRunContext<Payload, Result>) => Promise<Result>;
	trigger?: TriggerStrategy;
}

export interface Workflow<Payload, Result> {
	path: string;
	run: (
		client: Client,
		params: WorkflowRunParams<Payload>,
	) => Promise<WorkflowRun<Payload, Result>>;
	_execute: (context: WorkflowRunContext<Payload, Result>) => Promise<Result>;
}

class WorkflowImpl<Payload, Result> implements Workflow<Payload, Result> {
	public readonly path: string;
	public readonly _execute: (
		context: WorkflowRunContext<Payload, Result>,
	) => Promise<Result>;

	constructor(private readonly params: WorkflowParams<Payload, Result>) {
		this.path = `${params.name}/${params.version}`;
		// TODO execute should be it's own method that try catches run and updates status on failure
		// TODO: no need to execute if workflow result is in final state or paused state
		this._execute = params.run;
	}

	public async run(
		client: Client,
		workflowRunParams: WorkflowRunParams<Payload>,
	): Promise<WorkflowRun<Payload, Result>> {
		const workflowRunRow = await client.workflowRunRepository.create(
			this,
			workflowRunParams,
		);
		return initWorkflowRun({
			repository: client.workflowRunRepository,
			workflowRunRow,
		});
	}
}
