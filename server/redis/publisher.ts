import type { Redis } from "ioredis";
import { isNonEmptyArray } from "@aikirun/lib/array";
import type { Logger } from "../logger/index";

export interface WorkflowMessageToPublish {
	workflowRunId: string;
	workflowName: string;
	shardKey?: string;
}

export async function publishWorkflowReadyBatch(
	redis: Redis,
	messages: WorkflowMessageToPublish[],
	logger: Logger
): Promise<void> {
	if (!isNonEmptyArray(messages)) {
		return;
	}

	try {
		const messagesByStream = new Map<string, WorkflowMessageToPublish[]>();
		for (const message of messages) {
			const streamName =
				message.shardKey !== undefined
					? `workflow:${message.workflowName}:${message.shardKey}`
					: `workflow:${message.workflowName}`;

			const streamMessages = messagesByStream.get(streamName);
			if (streamMessages === undefined) {
				messagesByStream.set(streamName, [message]);
			} else {
				streamMessages.push(message);
			}
		}

		const pipeline = redis.pipeline();

		for (const [streamName, streamMessages] of messagesByStream.entries()) {
			for (const message of streamMessages) {
				pipeline.xadd(streamName, "*", "type", "workflow_run_ready", "workflowRunId", message.workflowRunId);
			}
		}

		await pipeline.exec();
	} catch (error) {
		logger.error(
			{
				messageCount: messages.length,
				error,
			},
			"Failed to batch publish workflow ready messages"
		);
	}
}
