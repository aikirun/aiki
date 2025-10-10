import type { WorkflowName, WorkflowVersionId } from "@aiki/contract/workflow";
import type { WorkflowOptions, WorkflowRunId } from "@aiki/contract/workflow-run";
import type { Client } from "../../client/client.ts";
import type { WorkflowRunContext } from "../run/context.ts";
import { initWorkflowRunResultHandle, type WorkflowRunResultHandle } from "../run/result-handle.ts";
import { isNonEmptyArray } from "@aiki/lib/array";

export interface WorkflowVersionParams<Input, Output> {
	exec: (
		input: Input,
		runCtx: WorkflowRunContext<Input, Output>,
	) => Promise<Output>;
}

export interface WorkflowVersion<Input, Output> {
	name: WorkflowName;
	versionId: WorkflowVersionId;

	withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output>;

	start: (
		client: Client,
		...args: Input extends null ? [] : [Input]
	) => Promise<WorkflowRunResultHandle<Output>>;

	_internal: {
		exec: (
			client: Client,
			runCtx: WorkflowRunContext<Input, Output>,
			input: Input,
		) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Input, Output> implements WorkflowVersion<Input, Output> {
	public readonly _internal: WorkflowVersion<Input, Output>["_internal"];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output>,
		private readonly options?: WorkflowOptions,
	) {
		this._internal = {
			exec: this.exec.bind(this),
		};
	}

	public withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output> {
		return new WorkflowVersionImpl(
			this.name,
			this.versionId,
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start(
		client: Client,
		...args: Input extends null ? [] : [Input]
	): Promise<WorkflowRunResultHandle<Output>> {
		const response = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : null,
			options: this.options,
		});
		return initWorkflowRunResultHandle(response.run.id as WorkflowRunId, client.api);
	}

	private async exec(
		client: Client,
		runCtx: WorkflowRunContext<Input, Output>,
		input: Input,
	): Promise<void> {
		try {
			await this.params.exec(input, runCtx);
			// TODO: persists workflow run result
		} catch (error) {
			// deno-lint-ignore no-console
			console.error(`Error while executing workflow ${runCtx.id}`, error);

			await client.api.workflowRun.updateStateV1({ id: runCtx.id, state: "failed" });

			throw error;
		}
	}
}
