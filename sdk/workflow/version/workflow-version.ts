import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { BrandedString } from "@lib/string/mod.ts";
import type { WorkflowRunContext, WorkflowRunParams } from "../run/context.ts";
import type { Client } from "../../client/client.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "../run/result-handle.ts";
import type { WorkflowName } from "../workflow.ts";

export type WorkflowVersionId = BrandedString<"workflow_version_id">;

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
		const workflowRunRow = await client.workflowRunRepository.create(this, workflowRunParams);
		return initWorkflowRunResultHandle({
			id: workflowRunRow.id,
			repository: client.workflowRunRepository,
		});
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
