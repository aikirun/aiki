import { distributeRoundRobin, isNonEmptyArray, type NonEmptyArray, shuffleArray } from "@aikirun/lib/array";
import { getWorkerConsumerGroupName, getWorkflowStreamName } from "@aikirun/lib/path";
import { getRetryParams } from "@aikirun/lib/retry";
import type {
	Client,
	Logger,
	RedisClient,
	RedisStreamsSubscriberStrategy,
	StrategyCallbacks,
	SubscriberDelayParams,
	SubscriberMessageMeta,
	SubscriberStrategyBuilder,
	WorkflowRunBatch,
} from "@aikirun/types/client";
import { INTERNAL } from "@aikirun/types/symbols";
import type { WorkflowMeta } from "@aikirun/types/workflow";
import type { WorkflowRunId } from "@aikirun/types/workflow-run";
import { type } from "arktype";

/**
 * Redis stream entries structure returned by XREADGROUP command:
 * [
 *   [
 *     "stream-1",
 *     [
 *       [
 *         "message-1",
 *         [
 *   	       "version", 1,
 *           "type", "workflow_run_ready",
 *           "workflowRunId", "1a0dd834-e0a7-4170-b357-a9ce2564900c"
 *         ]
 *       ],
 *       [
 *         "message-2",
 *         [
 *           "version", 1,
 *           "type", "workflow_run_ready",
 *           "workflowRunId", "0bd81dd8-0bbb-4703-9455-afb199979acd"
 *         ]
 *       ]
 *     ]
 *   ]
 * ]
 */
const streamEntriesSchema = type(["string", type(["string", "unknown[]"]).array()]).array();

const rawStreamMessageFieldsToRecord = (rawFields: unknown[]): Record<string, unknown> => {
	const data: Record<string, unknown> = {};
	for (let i = 0; i < rawFields.length; i += 2) {
		if (i + 1 < rawFields.length) {
			const key = rawFields[i];
			if (typeof key === "string") {
				data[key] = rawFields[i + 1];
			}
		}
	}
	return data;
};

const streamMessageDataSchema = type({
	type: "'workflow_run_ready'",
	workflowRunId: "string > 0",
});

const streamPendingMessagesSchema = type(["string", "string", "number", "number"]).array();

export function createRedisStreamsStrategy(
	client: Client,
	strategy: RedisStreamsSubscriberStrategy,
	workflows: WorkflowMeta[],
	workerShards?: string[]
): SubscriberStrategyBuilder {
	const redis = client[INTERNAL].redis.getConnection();

	const logger = client.logger.child({
		"aiki.component": "redis-subscriber",
	});

	const streamConsumerGroupMap = getRedisStreamConsumerGroupMap(workflows, workerShards);
	const streams = Array.from(streamConsumerGroupMap.keys());

	const intervalMs = strategy.intervalMs ?? 50;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;
	const blockTimeMs = strategy.blockTimeMs ?? 1_000;
	const claimMinIdleTimeMs = strategy.claimMinIdleTimeMs ?? 180_000;

	const getNextDelay = (params: SubscriberDelayParams) => {
		switch (params.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "retry": {
				const retryParams = getRetryParams(params.attemptNumber, {
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
			case "at_capacity":
				return atCapacityIntervalMs;
			default:
				return params satisfies never;
		}
	};

	const getHeartbeat =
		(workerId: string) =>
		async (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta): Promise<void> => {
			try {
				await redis.xclaim(meta.stream, meta.consumerGroup, workerId, 0, meta.messageId, "JUSTID");
				logger.debug("Heartbeat sent", {
					"aiki.workerId": workerId,
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			} catch (error) {
				logger.warn("Heartbeat failed", {
					"aiki.workerId": workerId,
					"aiki.workflowRunId": workflowRunId,
					"aiki.error": error instanceof Error ? error.message : String(error),
				});
			}
		};

	const acknowledge = async (
		workerId: string,
		workflowRunId: WorkflowRunId,
		meta: SubscriberMessageMeta
	): Promise<void> => {
		try {
			const result = await redis.xack(meta.stream, meta.consumerGroup, meta.messageId);

			if (result === 0) {
				logger.warn("Message already acknowledged", {
					"aiki.workerId": workerId,
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			} else {
				logger.debug("Message acknowledged", {
					"aiki.workerId": workerId,
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			}
		} catch (error) {
			logger.error("Failed to acknowledge message", {
				"aiki.workerId": workerId,
				"aiki.workflowRunId": workflowRunId,
				"aiki.messageId": meta.messageId,
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	};

	return {
		async init(workerId: string, _callbacks: StrategyCallbacks) {
			for (const [stream, consumerGroup] of streamConsumerGroupMap) {
				try {
					await redis.xgroup("CREATE", stream, consumerGroup, "0", "MKSTREAM");
				} catch (error) {
					if (!(error as Error).message?.includes("BUSYGROUP")) {
						throw error;
					}
				}
			}

			return {
				type: strategy.type,
				getNextDelay,
				getNextBatch: (size: number) =>
					fetchRedisStreamMessages(
						redis,
						logger.child({ "aiki.workerId": workerId }),
						streams,
						streamConsumerGroupMap,
						workerId,
						size,
						blockTimeMs,
						claimMinIdleTimeMs
					),
				heartbeat: getHeartbeat(workerId),
				acknowledge,
			};
		},
	};
}

function getRedisStreamConsumerGroupMap(workflows: WorkflowMeta[], shards?: string[]): Map<string, string> {
	if (!shards || !isNonEmptyArray(shards)) {
		return new Map(
			workflows.map((workflow) => [
				getWorkflowStreamName(workflow.name, workflow.versionId),
				getWorkerConsumerGroupName(workflow.name, workflow.versionId),
			])
		);
	}

	return new Map(
		workflows.flatMap((workflow) =>
			shards.map((shard) => [
				getWorkflowStreamName(workflow.name, workflow.versionId, shard),
				getWorkerConsumerGroupName(workflow.name, workflow.versionId, shard),
			])
		)
	);
}

// TODO:
// - attempt to claim stuck messages before fething newer ones
// - instead of processing streams randomly, try to prioritise I/O bound streams over CPU hogs
async function fetchRedisStreamMessages(
	redis: RedisClient,
	logger: Logger,
	streams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	size: number,
	blockTimeMs: number,
	claimMinIdleTimeMs: number
): Promise<WorkflowRunBatch[]> {
	if (!isNonEmptyArray(streams)) {
		return [];
	}

	const perStreamBlockTimeMs = Math.max(50, Math.floor(blockTimeMs / streams.length));

	const batchSizePerStream = distributeRoundRobin(size, streams.length);
	const shuffledStreams = shuffleArray(streams);

	const streamEntries: unknown[] = [];
	for (let i = 0; i < shuffledStreams.length; i++) {
		const stream = shuffledStreams[i];
		if (!stream) {
			continue;
		}

		const streamBatchSize = batchSizePerStream[i];
		if (!streamBatchSize || streamBatchSize === 0) {
			continue;
		}

		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			continue;
		}

		try {
			const result = await redis.xreadgroup(
				"GROUP",
				consumerGroup,
				workerId,
				"COUNT",
				streamBatchSize,
				"BLOCK",
				perStreamBlockTimeMs,
				"STREAMS",
				stream,
				">"
			);
			if (result) {
				streamEntries.push(result);
			}
		} catch (error) {
			logger.error("XREADGROUP failed", {
				"aiki.stream": stream,
				"aiki.error": error instanceof Error ? error.message : String(error),
			});
		}
	}

	const workflowRuns = isNonEmptyArray(streamEntries)
		? await processRedisStreamMessages(redis, logger, streamConsumerGroupMap, streamEntries)
		: [];

	const remainingCapacity = size - workflowRuns.length;
	if (remainingCapacity > 0 && claimMinIdleTimeMs > 0) {
		const claimedWorkflowRuns = await claimStuckRedisStreamMessages(
			redis,
			logger,
			shuffledStreams,
			streamConsumerGroupMap,
			workerId,
			remainingCapacity,
			claimMinIdleTimeMs
		);
		for (const workflowRun of claimedWorkflowRuns) {
			workflowRuns.push(workflowRun);
		}
	}

	return workflowRuns;
}

async function processRedisStreamMessages(
	redis: RedisClient,
	logger: Logger,
	streamConsumerGroupMap: Map<string, string>,
	streamsEntries: NonEmptyArray<unknown>
): Promise<WorkflowRunBatch[]> {
	const workflowRuns: WorkflowRunBatch[] = [];
	for (const streamEntriesRaw of streamsEntries) {
		logger.debug("Raw stream entries", { "aiki.entries": streamEntriesRaw });

		const streamEntriesResult = streamEntriesSchema(streamEntriesRaw);
		if (streamEntriesResult instanceof type.errors) {
			logger.error("Invalid stream entries format", {
				"aiki.error": streamEntriesResult.summary,
			});
			continue;
		}

		for (const streamEntry of streamEntriesResult) {
			const [stream, messages] = streamEntry;

			const consumerGroup = streamConsumerGroupMap.get(stream);
			if (!consumerGroup) {
				logger.error("No consumer group found for stream", {
					"aiki.stream": stream,
				});
				continue;
			}

			for (const [messageId, rawFields] of messages) {
				const rawMessageData = rawStreamMessageFieldsToRecord(rawFields);
				const messageData = streamMessageDataSchema(rawMessageData);
				if (messageData instanceof type.errors) {
					logger.warn("Invalid message structure", {
						"aiki.stream": stream,
						"aiki.messageId": messageId,
						"aiki.error": messageData.summary,
					});
					await redis.xack(stream, consumerGroup, messageId);
					continue;
				}

				switch (messageData.type) {
					case "workflow_run_ready": {
						const workflowRunId = messageData.workflowRunId as WorkflowRunId;
						workflowRuns.push({
							data: { workflowRunId },
							meta: {
								stream,
								messageId,
								consumerGroup,
							},
						});
						break;
					}
					default:
						messageData.type satisfies never;
						continue;
				}
			}
		}
	}

	return workflowRuns;
}

async function claimStuckRedisStreamMessages(
	redis: RedisClient,
	logger: Logger,
	shuffledStreams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	maxClaim: number,
	minIdleMs: number
): Promise<WorkflowRunBatch[]> {
	if (maxClaim <= 0 || minIdleMs <= 0) {
		return [];
	}

	const claimaibleMessagesByStream = await findClaimableMessagesByStream(
		redis,
		logger,
		shuffledStreams,
		streamConsumerGroupMap,
		workerId,
		maxClaim,
		minIdleMs
	);
	if (!claimaibleMessagesByStream.size) {
		return [];
	}

	const claimPromises = Array.from(claimaibleMessagesByStream.entries()).map(async ([stream, messageIds]) => {
		if (!messageIds.length) {
			return null;
		}

		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			return null;
		}

		try {
			const claimedMessages = await redis.xclaim(stream, consumerGroup, workerId, minIdleMs, ...messageIds);
			return { stream, claimedMessages };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			if (errorMessage.includes("NOGROUP")) {
				logger.warn("Consumer group does not exist for stream, skipping claim operation", {
					"aiki.stream": stream,
					"aiki.consumerGroup": consumerGroup,
				});
			} else if (errorMessage.includes("BUSYGROUP")) {
				logger.warn("Consumer group busy for stream, skipping claim operation", {
					"aiki.stream": stream,
					"aiki.consumerGroup": consumerGroup,
				});
			} else if (errorMessage.includes("NOSCRIPT")) {
				logger.warn("Redis script not loaded for stream, skipping claim operation", {
					"aiki.stream": stream,
					"aiki.consumerGroup": consumerGroup,
				});
			} else {
				logger.error("Failed to claim messages from stream", {
					"aiki.stream": stream,
					"aiki.consumerGroup": consumerGroup,
					"aiki.messageIds": messageIds.length,
					"aiki.error": errorMessage,
				});
			}
			return null;
		}
	});

	const claimResults = await Promise.allSettled(claimPromises);

	const claimedStreamEntries: [string, unknown][] = [];
	for (const result of claimResults) {
		if (result.status === "fulfilled" && result.value !== null) {
			const { stream, claimedMessages } = result.value;
			claimedStreamEntries.push([stream, claimedMessages]);
		}
	}

	if (!isNonEmptyArray(claimedStreamEntries)) {
		return [];
	}
	return processRedisStreamMessages(redis, logger, streamConsumerGroupMap, [claimedStreamEntries]);
}

async function findClaimableMessagesByStream(
	redis: RedisClient,
	logger: Logger,
	shuffledStreams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	maxClaim: number,
	minIdleMs: number
): Promise<Map<string, string[]>> {
	const claimSizePerStream = distributeRoundRobin(maxClaim, shuffledStreams.length);
	const pendingPromises: Promise<{ stream: string; result: unknown }>[] = [];
	for (let i = 0; i < shuffledStreams.length; i++) {
		const stream = shuffledStreams[i];
		if (!stream) {
			continue;
		}

		const claimSize = claimSizePerStream[i];
		if (!claimSize || claimSize === 0) {
			continue;
		}

		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			continue;
		}

		const readPromise = redis
			.xpending(stream, consumerGroup, "IDLE", minIdleMs, "-", "+", claimSize)
			.then((result) => ({ stream, result }));
		pendingPromises.push(readPromise);
	}

	const pendingResults = await Promise.allSettled(pendingPromises);

	const claimableMessagesByStream = new Map<string, string[]>();

	for (const pendingResult of pendingResults) {
		if (pendingResult.status !== "fulfilled") {
			continue;
		}

		const { stream, result } = pendingResult.value;

		const parsedResult = streamPendingMessagesSchema(result);
		if (parsedResult instanceof type.errors) {
			logger.error("Invalid XPENDING response", {
				"aiki.stream": stream,
				"aiki.error": parsedResult.summary,
			});
			continue;
		}

		const claimableStreamMessages = claimableMessagesByStream.get(stream) ?? [];

		for (const [messageId, consumerName, _idleTimeMs, _deliveryCount] of parsedResult) {
			if (consumerName !== workerId) {
				claimableStreamMessages.push(messageId);
			}
		}

		if (claimableStreamMessages.length) {
			claimableMessagesByStream.set(stream, claimableStreamMessages);
		}
	}

	return claimableMessagesByStream;
}
