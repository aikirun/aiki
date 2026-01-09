import { isNonEmptyArray } from "@aikirun/lib/array";
import { getWorkflowStreamName } from "@aikirun/lib/path";
import type { WorkflowRun } from "@aikirun/types/workflow-run";
import type { Redis } from "ioredis";
import type { ServerContext } from "server/middleware/context";

export async function publishWorkflowReadyBatch(
	context: ServerContext,
	redis: Redis,
	runs: WorkflowRun[]
): Promise<void> {
	if (!isNonEmptyArray(runs)) {
		return;
	}

	try {
		const pipeline = redis.pipeline();

		for (const run of runs) {
			const streamName = getWorkflowStreamName(run.name, run.versionId, run.options.shard);
			pipeline.xadd(streamName, "*", "version", 1, "type", "workflow_run_ready", "workflowRunId", run.id);
		}

		const results = await pipeline.exec();
		context.logger.debug({ results }, "Messages sent");
	} catch (error) {
		context.logger.error(
			{
				messageCount: runs.length,
				error,
			},
			"Failed to publishw workflow_run_ready messages"
		);
	}
}
