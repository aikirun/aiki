import { isNonEmptyArray } from "@aikirun/lib/array";
import type { WorkflowRun } from "@aikirun/types/workflow-run";
import type { Redis } from "ioredis";
import type { ServerContext } from "server/middleware/context";

export async function publishWorkflowReadyBatch(
	context: ServerContext,
	redis: Redis,
	runs: WorkflowRun<unknown, unknown>[]
): Promise<void> {
	if (!isNonEmptyArray(runs)) {
		return;
	}

	try {
		const pipeline = redis.pipeline();

		for (const run of runs) {
			const streamName = run.options.shardKey
				? `workflow/${run.workflowId}/${run.workflowVersionId}/${run.options.shardKey}`
				: `workflow/${run.workflowId}/${run.workflowVersionId}`;

			pipeline.xadd(streamName, "*", "type", "workflow_run_ready", "workflowRunId", run.id);
		}

		await pipeline.exec();
	} catch (error) {
		context.logger.error(
			{
				messageCount: runs.length,
				error,
			},
			"Failed to publishw orkflow_run_ready messages"
		);
	}
}
