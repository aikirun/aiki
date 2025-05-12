import type { MaybeField } from "@aiki/lib/object";
import type { RetryStrategy } from "@aiki/lib/retry";
import type { WorkflowRun } from "./workflow_run.ts";

export function task<
    Payload = undefined, 
    Result = void
>(params: TaskParams<Payload, Result>): Task<Payload, Result> {
    return new TaskImpl(params);
}

export interface TaskParams<Payload, Result> {
    name: string;
    run: (context: TaskRunContext<Payload>) => Promise<Result>;
    retry?: RetryStrategy;
}

export type TaskRunContext<Payload> = MaybeField<"payload", Payload>;

export interface Task<Payload, Result> {
	run: <WorkflowPayload, WorkflowResult>(
		workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>,
		params: TaskRunParams<Payload>
	) => Promise<Result>;
}

export type TaskRunParams<Payload> = TaskRunContext<Payload> & {
	idempotencyKey?: string;
	retry?: RetryStrategy;
};

export class TaskImpl<Payload, Result> implements Task<Payload, Result> {
    constructor(private readonly params: TaskParams<Payload, Result>) {}

    public async run<WorkflowPayload, WorkflowResult>(
        workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>, 
        taskRunParams: TaskRunParams<Payload>
    ): Promise<Result> {
        const path = this.getPath(workflowRun, taskRunParams);

        const preExistingResult = workflowRun._getSubTaskRunResult<Result>(path);
        if (preExistingResult.state === "completed") {
            return preExistingResult.result;
        }

        // TODO: check if result state is failed and there are still retries left
        // if not update workflow state to failed and return
        try {
            const result = await this.params.run(taskRunParams);
            await workflowRun._addSubTaskRunResult(path, {
                state: "completed",
                result
            });
        } catch (error) {
            workflowRun._addSubTaskRunResult(path, {
                state: "failed",
                // TODO: is error string?
                reason: error as string
            });
        }

        // TODO: specify error type
        throw new Error();
    }

    private getPath<WorkflowPayload, WorkflowResult>(
        workflowRun: WorkflowRun<WorkflowPayload, WorkflowResult>,
        taskRunParams: TaskRunParams<Payload>
    ): string {
        // TODO: instead of stringify consider a binary encoding scheme
        const payloadString = JSON.stringify(taskRunParams.payload);

        return taskRunParams.idempotencyKey
            ? `${workflowRun.path}/${this.params.name}/${taskRunParams.idempotencyKey}/${payloadString}`
            : `${workflowRun.path}/${this.params.name}/${payloadString}`;
    }
}

export * from "./task_run.ts";
export * from "./task_example.ts";