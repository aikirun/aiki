import type { TriggerStrategy } from "@aiki/lib/trigger";
import type { WorkflowName, WorkflowRunParams, WorkflowVersionId } from "@aiki/types/workflow";
import type { Client } from "../../client/client.ts";
import type { WorkflowRunContext } from "../run/context.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "../run/result-handle.ts";

export interface WorkflowVersionParams<Payload, Result> {
	run: (
		ctx: WorkflowRunContext<Payload, Result>,
		payload: Payload,
	) => Promise<Result>;
	trigger?: TriggerStrategy;
}

export interface WorkflowVersion<Payload, Result> {
	name: WorkflowName;
	versionId: WorkflowVersionId;
	enqueue: (
		client: Client,
		workflowRunParams: WorkflowRunParams<Payload>,
	) => Promise<WorkflowRunResultHandle<Result>>;
	_execute: (
		ctx: WorkflowRunContext<Payload, Result>,
		payload: Payload,
	) => Promise<void>;
}

export class WorkflowVersionImpl<Payload, Result> implements WorkflowVersion<Payload, Result> {
	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Payload, Result>,
	) {}

	public async enqueue(
		client: Client,
		workflowRunParams: WorkflowRunParams<Payload>,
	): Promise<WorkflowRunResultHandle<Result>> {
		const workflowRunRow = await client.api.workflowRun.createV1.mutate({
			name: this.name,
			versionId: this.versionId,
			params: workflowRunParams,
		});
		return initWorkflowRunResultHandle(workflowRunRow.id, client.api);
	}

	public async _execute(
		ctx: WorkflowRunContext<Payload, Result>,
		payload: Payload,
	): Promise<void> {
		try {
			await this.params.run(ctx, payload);
			// TODO: persists workflow run result
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Error while executing workflow ${ctx.workflowRun.path}`, error);

			ctx.workflowRun.updateState("failed");

			throw error;
		}
	}
}
