import { sha256 } from "@aiki/lib/crypto";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { ValidPayload } from "@aiki/contract/common";
import type { TaskName } from "@aiki/contract/task";
import type { WorkflowRunContext } from "../workflow/run/context.ts";
import { isNonEmptyArray } from "@aiki/lib/array";

export function task<
	Payload extends ValidPayload = null,
	Result = void,
>(params: TaskParams<Payload, Result>): Task<Payload, Result> {
	return new TaskImpl(params);
}

export interface TaskParams<Payload, Result> {
	name: string;
	exec: (payload: Payload) => Promise<Result>;
}

export interface TaskOptions {
	retry?: RetryStrategy;
	idempotencyKey?: string;
}

export interface Task<Payload, Result> {
	name: TaskName;

	withOptions(options: TaskOptions): Task<Payload, Result>;

	start: <WorkflowPayload, WorkflowResult>(
		runCtx: WorkflowRunContext<WorkflowPayload, WorkflowResult>,
		...args: Payload extends null ? [] : [Payload]
	) => Promise<Result>;
}

class TaskImpl<Payload, Result> implements Task<Payload, Result> {
	public readonly name: TaskName;

	constructor(
		private readonly params: TaskParams<Payload, Result>,
		private readonly options?: TaskOptions,
	) {
		this.name = params.name as TaskName;
	}

	public withOptions(options: TaskOptions): Task<Payload, Result> {
		return new TaskImpl(
			this.params,
			{ ...this.options, ...options },
		);
	}

	public async start<WorkflowPayload, WorkflowResult>(
		runCtx: WorkflowRunContext<WorkflowPayload, WorkflowResult>,
		...args: Payload extends null ? [] : [Payload]
	): Promise<Result> {
		// this cast is okay cos if args is empty, Payload must be of type null
		const payload = isNonEmptyArray(args) ? args[0] : null as Payload;
		const path = await this.getPath(runCtx, payload);

		const workflowRunInternal = runCtx.handle._internal;

		const preExistingResult = workflowRunInternal.getSubTaskRunResult<Result>(path);
		if (preExistingResult.state === "completed") {
			return preExistingResult.result;
		}

		// TODO: check if result state is failed and there are still retries left
		// if not update workflow state to failed and return
		try {
			const result = await this.params.exec(payload);
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

	private async getPath<WorkflowPayload, WorkflowResult>(
		runCtx: WorkflowRunContext<WorkflowPayload, WorkflowResult>,
		payload: Payload,
	): Promise<string> {
		const workflowRunPath = `${runCtx.name}/${runCtx.versionId}/${runCtx.id}`;

		const payloadHash = await sha256(JSON.stringify(payload));

		return this.options?.idempotencyKey
			? `${workflowRunPath}/${this.name}/${payloadHash}/${this.options.idempotencyKey}`
			: `${workflowRunPath}/${this.name}/${payloadHash}`;
	}
}
