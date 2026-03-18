import { getWorkflowStreamName } from "@aikirun/lib/address";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { Redis } from "ioredis";
import type { Context } from "server/middleware/context";

export interface WorkflowRunReadyMessage {
	id: string;
	name: string;
	versionId: string;
	shard?: string;
}

export function createWorkflowRunPublisher(redis: Redis) {
	return {
		async publishReadyRuns(context: Context, runs: WorkflowRunReadyMessage[]): Promise<void> {
			if (!isNonEmptyArray(runs)) {
				return;
			}

			try {
				const pipeline = redis.pipeline();

				for (const run of runs) {
					const streamName = getWorkflowStreamName(run.name, run.versionId, run.shard);
					pipeline.xadd(streamName, "*", "version", "1", "type", "workflow_run_ready", "workflowRunId", run.id);
				}

				const results = await pipeline.exec();
				context.logger.debug({ results }, "Messages sent");
			} catch (error) {
				context.logger.error(
					{
						messageCount: runs.length,
						error,
					},
					"Failed to publish workflow_run_ready messages"
				);
				throw error;
			}
		},
	};
}

export type WorkflowRunPublisher = ReturnType<typeof createWorkflowRunPublisher>;
