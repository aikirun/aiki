import type { RetryStrategy } from "@lib/retry/mod.ts";
import type { TaskRunContext, TaskRunParams } from "./run/context.ts";
import { sha256 } from "@lib/crypto/mod.ts";
import type { WorkflowRunContext } from "@aiki/sdk";

export function task<
	Payload = undefined,
	Result = void,
>(params: TaskParams<Payload, Result>): Task<Payload, Result> {
	return new TaskImpl(params);
}

export interface TaskParams<Payload, Result> {
	name: string;
	run: (context: TaskRunContext<Payload>) => Promise<Result>;
	retry?: RetryStrategy;
}

export interface Task<Payload, Result> {
	run: <WorkflowPayload, WorkflowResult>(
		ctx: WorkflowRunContext<WorkflowPayload, WorkflowResult>,
		params: TaskRunParams<Payload>,
	) => Promise<Result>;
}

class TaskImpl<Payload, Result> implements Task<Payload, Result> {
	constructor(private readonly params: TaskParams<Payload, Result>) {}

	public async run<WorkflowPayload, WorkflowResult>(
		ctx: WorkflowRunContext<WorkflowPayload, WorkflowResult>,
		taskRunParams: TaskRunParams<Payload>,
	): Promise<Result> {
		const path = await this.getPath(ctx.workflowRun.path, taskRunParams);

		const workflowRunInternal = ctx.workflowRun._internal;

		const preExistingResult = workflowRunInternal.getSubTaskRunResult<Result>(path);
		if (preExistingResult.state === "completed") {
			return preExistingResult.result;
		}

		// TODO: check if result state is failed and there are still retries left
		// if not update workflow state to failed and return
		try {
			const result = await this.params.run(taskRunParams);
			await workflowRunInternal.addSubTaskRunResult(path, {
				state: "completed",
				result,
			});
		} catch (error) {
			workflowRunInternal.addSubTaskRunResult(path, {
				state: "failed",
				// TODO: is error string?
				reason: error as string,
			});
		}

		// TODO: specify error type
		throw new Error();
	}

	private async getPath(
		workflowRunPath: string,
		taskRunParams: TaskRunParams<Payload>,
	): Promise<string> {
		const payloadHash = await sha256(JSON.stringify(taskRunParams.payload));

		return taskRunParams.idempotencyKey
			? `${workflowRunPath}/${this.params.name}/${payloadHash}/${taskRunParams.idempotencyKey}`
			: `${workflowRunPath}/${this.params.name}/${payloadHash}`;
	}
}
