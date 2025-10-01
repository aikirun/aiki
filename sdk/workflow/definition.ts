import type { TriggerStrategy } from "@lib/trigger/mod.ts";
import type { BrandedString } from "@lib/string/mod.ts";
import type { WorkflowRunContext, WorkflowRunParams } from "./run/context.ts";
import type { Client } from "../client/definition.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "./run/result-handle.ts";

export function workflow(params: WorkflowParams): Workflow {
	return new WorkflowImpl(params);
}

export interface WorkflowParams {
	name: string;
}

export type WorkflowName = BrandedString<"workflow_name">;

export interface Workflow {
	name: WorkflowName;
	v: <Payload, Result>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result>,
	) => WorkflowVersion<Payload, Result>;
	_internal: {
		getAllVersions: () => Array<WorkflowVersion<unknown, unknown>>;
		getVersion: (versionId: WorkflowVersionId) => WorkflowVersion<unknown, unknown> | undefined;
	};
}

class WorkflowImpl implements Workflow {
	public readonly name: WorkflowName;
	public readonly _internal: Workflow["_internal"];
	private workflowVersionMap = new Map<WorkflowVersionId, WorkflowVersion<unknown, unknown>>();

	constructor(params: WorkflowParams) {
		this.name = params.name as WorkflowName;
		this._internal = {
			getAllVersions: () => Array.from(this.workflowVersionMap.values()),
			getVersion: (versionId: WorkflowVersionId) => this.workflowVersionMap.get(versionId),
		};
	}

	v<Payload, Result>(
		versionId: string,
		params: WorkflowVersionParams<Payload, Result>,
	): WorkflowVersion<Payload, Result> {
		const workflowVersion = new WorkflowVersionImpl(this.name, versionId as WorkflowVersionId, params);
		this.workflowVersionMap.set(
			versionId as WorkflowVersionId,
			workflowVersion as unknown as WorkflowVersion<unknown, unknown>,
		);
		return workflowVersion;
	}
}

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

class WorkflowVersionImpl<Payload, Result> implements WorkflowVersion<Payload, Result> {
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
