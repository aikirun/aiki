import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { WorkflowOptions } from "@aiki/contract/workflow-run";
import type { Client } from "../../client/client.ts";
import type { WorkflowRunContext } from "../run/context.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "../run/result-handle.ts";
import { isNonEmptyArray } from "@aiki/lib/array";

export interface WorkflowVersionParams<Payload, Result> {
	exec: (
		runCtx: WorkflowRunContext<Payload, Result>,
		payload: Payload,
	) => Promise<Result>;
}

export interface WorkflowVersion<Payload, Result> {
	name: WorkflowName;
	versionId: WorkflowVersionId;

	withOptions(options: WorkflowOptions): WorkflowVersion<Payload, Result>;

	start: (
		client: Client,
		...args: Payload extends null ? [] : [Payload]
	) => Promise<WorkflowRunResultHandle<Result>>;

	_internal: {
		_exec: (
			client: Client,
			runCtx: WorkflowRunContext<Payload, Result>,
			payload: Payload,
		) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Payload, Result> implements WorkflowVersion<Payload, Result> {
	public readonly _internal: WorkflowVersion<Payload, Result>["_internal"];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Payload, Result>,
		private readonly options?: WorkflowOptions,
	) {
		this._internal = {
			_exec: this.exec,
		};
	}

	public withOptions(options: WorkflowOptions): WorkflowVersion<Payload, Result> {
		return new WorkflowVersionImpl(
			this.name,
			this.versionId,
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start(
		client: Client,
		...args: Payload extends null ? [] : [Payload]
	): Promise<WorkflowRunResultHandle<Result>> {
		const response = await client.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			payload: isNonEmptyArray(args) ? args[0] : null,
			options: this.options,
		});
		return initWorkflowRunResultHandle(response.run.id, client.workflowRun);
	}

	private async exec(
		client: Client,
		runCtx: WorkflowRunContext<Payload, Result>,
		payload: Payload,
	): Promise<void> {
		try {
			await this.params.exec(runCtx, payload);
			// TODO: persists workflow run result
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Error while executing workflow ${runCtx.id}`, error);

			await client.workflowRun.updateStateV1({ id: runCtx.id, state: "failed" });

			throw error;
		}
	}
}
