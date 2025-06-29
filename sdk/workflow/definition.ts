import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { WorkflowRunContext, WorkflowRunParams } from "./run/context.ts";
import type { Client } from "../client/definition.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "./run/result-handle.ts";

export function workflow<
	Payload = undefined,
	Result = void,
>(params: WorkflowParams<Payload, Result>): Workflow<Payload, Result> {
	return new WorkflowImpl(params);
}

export interface WorkflowParams<Payload, Result> {
	name: string;
	version: `${number}.${number}.${number}`;
	run: (context: WorkflowRunContext<Payload, Result>) => Promise<Result>;
	trigger?: TriggerStrategy;
}

export interface Workflow<Payload, Result> {
	path: string;
	enqueue: (
		client: Client,
		_params: WorkflowRunParams<Payload>, // TODO: params is unused
	) => Promise<WorkflowRunResultHandle<Result>>;
	_execute: (context: WorkflowRunContext<Payload, Result>) => Promise<void>;
}

class WorkflowImpl<Payload, Result> implements Workflow<Payload, Result> {
	public readonly path: string;

	constructor(private readonly params: WorkflowParams<Payload, Result>) {
		this.path = `${params.name}/${params.version}`;
	}

	public async enqueue(
		client: Client,
		workflowRunParams: WorkflowRunParams<Payload>,
	): Promise<WorkflowRunResultHandle<Result>> {
		const workflowRunRow = await client.workflowRunRepository.create(
			this,
			workflowRunParams,
		);
		return initWorkflowRunResultHandle({
			id: workflowRunRow.id,
			repository: client.workflowRunRepository,
		});
	}

	public async _execute(context: WorkflowRunContext<Payload, Result>): Promise<void> {
		try {
			await this.params.run(context);
			// TODO: persists workflow run result
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Error while executing workflow ${context.workflowRun.path}`, error);

			context.workflowRun.updateState("failed");

			throw error;
		}
	}
}
