import { sha256 } from "@aiki/lib/crypto";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { SerializableInput } from "@aiki/contract/common";
import type { TaskName } from "@aiki/contract/task";
import type { WorkflowRunContext } from "@aiki/workflow";
import { isNonEmptyArray } from "@aiki/lib/array";

export function task<
	Input extends SerializableInput = null,
	Output = void,
>(params: TaskParams<Input, Output>): Task<Input, Output> {
	return new TaskImpl(params);
}

export interface TaskParams<Input, Output> {
	name: string;
	exec: (input: Input) => Promise<Output>;
}

export interface TaskOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
}

export interface Task<Input, Output> {
	name: TaskName;

	withOptions(options: TaskOptions): Task<Input, Output>;

	start: <WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		...args: Input extends null ? [] : [Input]
	) => Promise<Output>;
}

class TaskImpl<Input, Output> implements Task<Input, Output> {
	public readonly name: TaskName;

	constructor(
		private readonly params: TaskParams<Input, Output>,
		private readonly options?: TaskOptions,
	) {
		this.name = params.name as TaskName;
	}

	public withOptions(options: TaskOptions): Task<Input, Output> {
		return new TaskImpl(
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		...args: Input extends null ? [] : [Input]
	): Promise<Output> {
		// this cast is okay cos if args is empty, Input must be of type null
		const input = isNonEmptyArray(args) ? args[0] : null as Input;
		const path = await this.getPath(run, input);

		const preExistingResult = run.handle._internal.getSubTaskRunResult<Output>(path);
		if (preExistingResult.state === "completed") {
			return preExistingResult.output;
		}

		// TODO: check if result state is failed and there are still retries left
		// if not update workflow state to failed and return
		try {
			const output = await this.params.exec(input);
			await run.handle._internal.addSubTaskRunResult(path, {
				state: "completed",
				output,
			});
			return output;
		} catch (error) {
			await run.handle._internal.addSubTaskRunResult(path, {
				state: "failed",
				// TODO: is error string?
				reason: error as string,
			});

			// TODO: specify error type. What to do in case of failed task exec?
			throw new Error();
		}
	}

	private async getPath<WorkflowInput, WorkflowOutput>(
		run: WorkflowRunContext<WorkflowInput, WorkflowOutput>,
		input: Input,
	): Promise<string> {
		const workflowRunPath = `${run.name}/${run.versionId}/${run.id}`;

		const inputHash = await sha256(JSON.stringify(input));

		return this.options?.idempotencyKey
			? `${workflowRunPath}/${this.name}/${inputHash}/${this.options.idempotencyKey}`
			: `${workflowRunPath}/${this.name}/${inputHash}`;
	}
}
