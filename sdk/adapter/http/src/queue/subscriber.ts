import { getRetryParams } from "@aikirun/lib/retry";
import type { ApiClient } from "@aikirun/types/client";
import type {
	CreateSubscriber,
	Subscriber,
	SubscriberDelayParams,
	WorkflowRunMessage,
} from "@aikirun/types/infra/queue";
import type { WorkflowRunId } from "@aikirun/types/workflow/run";

export interface HttpSubscriberParams {
	api: ApiClient;
	options?: HttpSubscriberOptions;
}

export interface HttpSubscriberOptions {
	intervalMs?: number;
	maxRetryIntervalMs?: number;
	claimMinIdleTimeMs?: number;
}

export function httpSubscriber(params: HttpSubscriberParams): CreateSubscriber {
	const { api, options } = params;
	const intervalMs = options?.intervalMs ?? 1_000;
	const maxRetryIntervalMs = options?.maxRetryIntervalMs ?? 30_000;
	const claimMinIdleTimeMs = options?.claimMinIdleTimeMs ?? 90_000;

	const getNextDelay = (delayParams: SubscriberDelayParams) => {
		switch (delayParams.type) {
			case "no_work":
				return intervalMs;
			case "retry": {
				const retryParams = getRetryParams(delayParams.attemptNumber, {
					type: "jittered",
					maxAttempts: Number.POSITIVE_INFINITY,
					baseDelayMs: intervalMs,
					maxDelayMs: maxRetryIntervalMs,
				});
				if (!retryParams.retriesLeft) {
					return maxRetryIntervalMs;
				}
				return retryParams.delayMs;
			}
			default:
				return delayParams satisfies never;
		}
	};

	return ({ workflows, shards, signal }): Subscriber => {
		return {
			getNextDelay,
			async getReadyRuns(size: number): Promise<WorkflowRunMessage[]> {
				const response = await api.workflowRun.claimReadyV1(
					{
						workflows: workflows.map((workflow) => ({ name: workflow.name, versionId: workflow.versionId })),
						shards,
						limit: size,
						claimMinIdleTimeMs,
					},
					{ signal }
				);

				return response.runs.map((run) => ({
					data: { id: run.id as WorkflowRunId },
				}));
			},
		};
	};
}
