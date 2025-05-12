import type { MaybeField } from "@aiki/lib/object";
import type { TriggerStrategy } from "@aiki/lib/trigger";
import type { AikiClient } from "./client.ts";
import { initWorkflowRun, type WorkflowRun } from "./workflow_run.ts";

export function workflow<
	Payload = undefined, 
	Result = void
>(params: WorkflowParams<Payload, Result>): Workflow<Payload, Result> {
	return new WorkflowImpl(params);
}

export interface WorkflowParams<Payload, Result> {
	name: string;
	version: string;
	run: (context: WorkflowContext<Payload, Result>) => Promise<Result>;
	trigger?: TriggerStrategy;
}

export interface WorkflowContext<Payload, Result> {
	workflowRun: WorkflowRun<Payload, Result>;
}

export interface Workflow<Payload, Result> {
	path: string;
	run: (
		client: AikiClient,
		params: WorkflowRunParams<Payload>
	) => Promise<WorkflowRun<Payload, Result>>;
	_execute: (params: WorkflowContext<Payload, Result>) => Promise<Result>;
}

export type WorkflowRunParams<Payload> = MaybeField<"payload", Payload> & {
	idempotencyKey?: string;
	trigger?: TriggerStrategy;
}

export class WorkflowImpl<Payload, Result> implements Workflow<Payload, Result> {
	public readonly path: string;
	public readonly _execute: (params: WorkflowContext<Payload, Result>) => Promise<Result>;

	constructor(private readonly params: WorkflowParams<Payload, Result>) {
		this.path = `${params.name}/${params.version}`;
		this._execute = params.run;
	}

	public async run(
		client: AikiClient, 
		workflowRunParams: WorkflowRunParams<Payload>
	): Promise<WorkflowRun<Payload, Result>> {
		const workflowRunRow = await client.workflowRun.create(this, workflowRunParams);
		return initWorkflowRun({
			repository: client.workflowRun,
			workflowRunRow
		});
	}
}

export * from "./workflow_repository.ts";
export * from "./workflow_example.ts";

export * from "./workflow_run.ts";
export * from "./workflow_run_repository.ts";
export * from "./workflow_run_subscriber.ts";