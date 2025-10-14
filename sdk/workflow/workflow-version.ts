import type { WorkflowName, WorkflowVersionId } from "@aiki/types/workflow";
import type { WorkflowOptions, WorkflowRunId } from "@aiki/types/workflow-run";
import type { Client } from "@aiki/types/client";
import type { WorkflowRunContext } from "./run/context.ts";
import { initWorkflowRunStateHandle, type WorkflowRunStateHandle } from "./run/state-handle.ts";
import { isNonEmptyArray } from "@aiki/lib/array";

export interface WorkflowVersionParams<Input, Output, AppContext> {
	exec: (
		input: Input,
		run: WorkflowRunContext<Input, Output>,
		context: AppContext,
	) => Promise<Output>;
}

export interface WorkflowVersion<Input, Output, AppContext> {
	name: WorkflowName;
	versionId: WorkflowVersionId;

	withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output, AppContext>;

	start: (
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	) => Promise<WorkflowRunStateHandle<Output>>;

	_internal: {
		exec: (
			client: Client<AppContext>,
			input: Input,
			run: WorkflowRunContext<Input, Output>,
			context: AppContext,
		) => Promise<void>;
	};
}

export class WorkflowVersionImpl<Input, Output, AppContext> implements WorkflowVersion<Input, Output, AppContext> {
	public readonly _internal: WorkflowVersion<Input, Output, AppContext>["_internal"];

	constructor(
		public readonly name: WorkflowName,
		public readonly versionId: WorkflowVersionId,
		private readonly params: WorkflowVersionParams<Input, Output, AppContext>,
		private readonly options?: WorkflowOptions,
	) {
		this._internal = {
			exec: this.exec.bind(this),
		};
	}

	public withOptions(options: WorkflowOptions): WorkflowVersion<Input, Output, AppContext> {
		return new WorkflowVersionImpl(
			this.name,
			this.versionId,
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start(
		client: Client<AppContext>,
		...args: Input extends null ? [] : [Input]
	): Promise<WorkflowRunStateHandle<Output>> {
		const response = await client.api.workflowRun.createV1({
			name: this.name,
			versionId: this.versionId,
			input: isNonEmptyArray(args) ? args[0] : null,
			options: this.options,
		});
		return initWorkflowRunStateHandle(response.run.id as WorkflowRunId, client.api);
	}

	private async exec(
		client: Client<AppContext>,
		input: Input,
		run: WorkflowRunContext<Input, Output>,
		context: AppContext,
	): Promise<void> {
		try {
			await this.params.exec(input, run, context);
			// TODO: persists workflow run state
		} catch (error) {
			// TODO: check if it was caused by TaskFailedError
			run.logger.error("Error while executing workflow", {
				"aiki.workflowRunId": run.id,
				"aiki.error": error instanceof Error ? error.message : String(error),
				"aiki.stack": error instanceof Error ? error.stack : undefined,
			});

			await client.api.workflowRun.updateStateV1({ id: run.id, state: "failed" });

			throw error;
		}
	}
}
