import { withRetry } from "@lib/retry/strategy.ts";
import type { WorkflowRunRepository } from "./repository.ts";
import type { WorkflowRunResult, WorkflowRunResultComplete, WorkflowRunResultInComplete, WorkflowRunState } from "./result.ts";

export function initWorkflowRunResultHandle<Result>(
    params: {
        id: string,
        repository: WorkflowRunRepository;
    },
) {
    return new WorkflowRunResultHandleImpl<Result>(params.id, params.repository);
}

export interface WorkflowRunWaitSyncParams {
    pollIntervalMs?: number;
    maxDurationMs: number;
}

export interface WorkflowRunResultHandle<Result> {
    id: string;

    getResult: () => Promise<WorkflowRunResult<Result>>;

    waitForState<
        T extends WorkflowRunState,
        U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
            : WorkflowRunResultInComplete),
    >(state: T, params: WorkflowRunWaitSyncParams): Promise<U>;
}

class WorkflowRunResultHandleImpl<Result> implements WorkflowRunResultHandle<Result> {
    constructor(
        public readonly id: string,
        private readonly repository: WorkflowRunRepository,
    ) {}

    public getResult(): Promise<WorkflowRunResult<Result>> {
        return this.repository.getResult(this.id);
    }

    public async waitForState<
        T extends WorkflowRunState,
        U extends (T extends "completed" ? WorkflowRunResultComplete<Result>
            : WorkflowRunResultInComplete),
    >(state: T, params: WorkflowRunWaitSyncParams): Promise<U> {
        const delayMs = params.pollIntervalMs ?? 100;

        const result = await withRetry(
            this.getResult,
            {
                type: "fixed",
                maxAttempts: Math.ceil(params.maxDurationMs / delayMs),
                delayMs,
            },
            (result) => Promise.resolve(result.state !== state),
        ).run();

        return result as U;
    }
}