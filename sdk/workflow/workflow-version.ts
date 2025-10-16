import type { WorkflowName, WorkflowVersionId } from "@aiki/types/workflow";
import type { WorkflowOptions, WorkflowRunId, WorkflowRunStateFailed } from "@aiki/types/workflow-run";
import type { Client } from "@aiki/types/client";
import type { WorkflowRunContext } from "./run/context.ts";
import { initWorkflowRunStateHandle, type WorkflowRunStateHandle } from "./run/state-handle.ts";
import { isNonEmptyArray } from "@aiki/lib/array";
import { createSerializableError } from "../error.ts";
import { TaskFailedError } from "@aiki/task";
import {
	WorkflowCancelledError,
	WorkflowNotExecutableError,
	WorkflowPausedError,
} from "./run/error.ts";

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
		input: Input,
		run: WorkflowRunContext<Input, Output>,
		context: AppContext,
	): Promise<void> {
		try {
			await run.handle.transitionState({ status: "running" });
			const output = await this.params.exec(input, run, context);
			await run.handle.transitionState({ status: "completed", output });

			run.logger.info("Workflow completed successfully", {
				"aiki.workflowRunId": run.id,
			});
		} catch (error) {
			if (error instanceof WorkflowCancelledError) {
				run.logger.info("Workflow was cancelled");
				return;
			}

			if (error instanceof WorkflowPausedError) {
				run.logger.info("Workflow was paused");
				return;
			}

			if (error instanceof WorkflowNotExecutableError) {
				run.logger.info("Workflow not executable", {
					"aiki.currentState": error.currentState,
				});
				return;
			}

			const failedState = this.createFailedState(error);

			run.logger.error("Workflow execution failed", {
				"aiki.failureCause": failedState.cause,
				"aiki.reason": failedState.reason,
				...(failedState.cause === "task" && { "aiki.taskName": failedState.taskName }),
			});

			await run.handle.transitionState(failedState);
		}
	}

	private createFailedState(error: unknown): WorkflowRunStateFailed {
		if (error instanceof TaskFailedError) {
			return {
				status: "failed",
				cause: "task",
				taskName: error.taskName,
				reason: error.reason,
			};
		}

		const serializableError = createSerializableError(error);

		// TODO: check for other error types
		return {
			status: "failed",
			cause: "self",
			reason: serializableError.message,
			error: serializableError,
		};
	}
}
