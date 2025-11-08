import { distributeRoundRobin, groupBy, isNonEmptyArray, type NonEmptyArray, shuffleArray } from "@aiki/lib/array";
import { z } from "zod";
import { getRetryParams } from "@aiki/lib/retry";
import type { WorkflowName } from "@aiki/types/workflow";
import type { WorkflowRunId } from "@aiki/types/workflow-run";
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
} from "@aiki/types/client";
import { getChildLogger } from "../logger/mod.ts";

const WorkflowRunReadyMessageDataSchema = z.object({
	type: z.literal("workflow_run_ready"),
	data: z.object({
		workflowRunId: z.string().transform((id: string) => id as WorkflowRunId),
	}),
});

const RedisMessageDataSchema = z.discriminatedUnion("type", [
	WorkflowRunReadyMessageDataSchema,
]);

const RedisMessageRawDataSchema = z.array(z.unknown()).transform((rawFields: unknown[]) => {
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
});

const RedisStreamMessageSchema = z.tuple([
	z.string(),
	RedisMessageRawDataSchema,
]);

/**
 * Redis stream entry structure returned by XREADGROUP command:
 * [
 *   "stream-1",
 *   [
 *     [
 *       "message-1",
 *       [
 *         "type", "workflow_run_ready",
 *         "data", "{\"workflowRunId\":\"1\"}"
 *       ]
 *     ],
 *     [
 *       "message-2",
 *       [
 *         "type", "workflow_run_ready",
 *         "data", "{\"workflowRunId\":\"2\"}"
 *       ]
 *     ]
 *   ]
 * ]
 */
const RedisStreamEntrySchema = z.tuple([
	z.string(),
	z.array(RedisStreamMessageSchema),
]);

const RedisStreamPendingMessageSchema = z.tuple([
	z.string(),
	z.string(),
	z.number(),
	z.number(),
]);

const RedisStreamPendingMessagesSchema = z.array(RedisStreamPendingMessageSchema);

interface ClaimableRedisStreamMessage {
	stream: string;
	messageId: string;
}

export function createRedisStreamsStrategy(
	client: Client<unknown>,
	strategy: RedisStreamsSubscriberStrategy,
	workflowNames: WorkflowName[],
	workerShards?: string[],
): SubscriberStrategyBuilder {
	const redis = client._internal.redis.getConnection();

	const logger = getChildLogger(client.logger, {
		"aiki.component": "redis-subscriber",
	});

	const streamConsumerGroupMap = getRedisStreamConsumerGroupMap(workflowNames, workerShards);
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
					maxAttempts: Infinity,
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
		(workerId: string) => async (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta): Promise<void> => {
			try {
				await redis.xclaim(
					meta.stream,
					meta.consumerGroup,
					workerId,
					0,
					meta.messageId,
					"JUSTID",
				);
				logger.debug("Heartbeat sent", {
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			} catch (error) {
				logger.warn("Heartbeat failed", {
					"aiki.workflowRunId": workflowRunId,
					"aiki.error": error instanceof Error ? error.message : String(error),
				});
			}
		};

	const acknowledge = async (workflowRunId: WorkflowRunId, meta: SubscriberMessageMeta): Promise<void> => {
		try {
			const result = await redis.xack(meta.stream, meta.consumerGroup, meta.messageId);

			if (result === 0) {
				logger.warn("Message already acknowledged", {
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			} else {
				logger.debug("Message acknowledged", {
					"aiki.workflowRunId": workflowRunId,
					"aiki.messageId": meta.messageId,
				});
			}
		} catch (error) {
			logger.error("Failed to acknowledge message", {
				"aiki.error": error instanceof Error ? error.message : String(error),
				"aiki.workflowRunId": workflowRunId,
				"aiki.messageId": meta.messageId,
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
						logger,
						streams,
						streamConsumerGroupMap,
						workerId,
						size,
						blockTimeMs,
						claimMinIdleTimeMs,
					),
				heartbeat: getHeartbeat(workerId),
				acknowledge,
			};
		},
	};
}

function getRedisStreamConsumerGroupMap(workflowNames: WorkflowName[], shardKeys?: string[]): Map<string, string> {
	if (!shardKeys || !isNonEmptyArray(shardKeys)) {
		return new Map(workflowNames.map((workflowName) => [
			`workflow:${workflowName}`,
			`worker:${workflowName}`,
		]));
	}

	return new Map(workflowNames.flatMap((workflowName) =>
		shardKeys.map((shardKey) => [
			`workflow:${workflowName}:${shardKey}`,
			`worker:${workflowName}:${shardKey}`,
		])
	));
}

// TODO: attempt to claim stuck messages before fething newer ones
async function fetchRedisStreamMessages(
	redis: RedisClient,
	logger: Logger,
	streams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	size: number,
	blockTimeMs: number,
	claimMinIdleTimeMs: number,
): Promise<WorkflowRunBatch[]> {
	if (!isNonEmptyArray(streams)) {
		return [];
	}

	const batchSizePerStream = distributeRoundRobin(size, streams.length);
	const shuffledStreams = shuffleArray(streams);

	const readPromises: Promise<unknown>[] = [];
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

		const readPromise = redis.xreadgroup(
			"GROUP",
			consumerGroup,
			workerId,
			"COUNT",
			streamBatchSize,
			"BLOCK",
			blockTimeMs,
			"STREAMS",
			stream,
			">",
		);
		readPromises.push(readPromise);
	}

	const readResults = await Promise.allSettled(readPromises);

	const streamEntries: unknown[] = [];
	for (const result of readResults) {
		if (result.status === "fulfilled" && result.value) {
			streamEntries.push(result.value);
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
			claimMinIdleTimeMs,
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
	streamEntries: NonEmptyArray<unknown>,
): Promise<WorkflowRunBatch[]> {
	const workflowRuns: WorkflowRunBatch[] = [];

	for (const streamEntry of streamEntries) {
		const streamEntryResult = RedisStreamEntrySchema.safeParse(streamEntry);
		if (!streamEntryResult.success) {
			logger.error("Invalid Redis stream entry structure", {
				"aiki.error": z.treeifyError(streamEntryResult.error),
			});
			continue;
		}

		const [stream, messages] = streamEntryResult.data;

		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			logger.error("No consumer group found for stream", {
				"aiki.stream": stream,
			});
			continue;
		}

		for (const [messageId, rawMessageData] of messages) {
			const messageData = RedisMessageDataSchema.safeParse(rawMessageData);
			if (!messageData.success) {
				logger.warn("Invalid message structure", {
					"aiki.stream": stream,
					"aiki.messageId": messageId,
					"aiki.error": z.treeifyError(messageData.error),
				});
				await redis.xack(stream, consumerGroup, messageId);
				continue;
			}

			switch (messageData.data.type) {
				case "workflow_run_ready": {
					const { workflowRunId } = messageData.data.data;
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
					messageData.data.type satisfies never;
					continue;
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
	minIdleMs: number,
): Promise<WorkflowRunBatch[]> {
	if (maxClaim <= 0 || minIdleMs <= 0) {
		return [];
	}

	const claimableMessages = await findClaimableRedisStreamMessages(
		redis,
		logger,
		shuffledStreams,
		streamConsumerGroupMap,
		workerId,
		maxClaim,
		minIdleMs,
	);

	if (!isNonEmptyArray(claimableMessages)) {
		return [];
	}

	const claimaibleMessagesByStream = groupBy(claimableMessages, (message) => [message.stream, message]);

	const claimPromises = Array.from(claimaibleMessagesByStream.entries()).map(async ([stream, messages]) => {
		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			return null;
		}

		const messageIds = messages.map((message) => message.messageId);

		try {
			const claimedMessages = await redis.xclaim(
				stream,
				consumerGroup,
				workerId,
				minIdleMs,
				...messageIds,
			);
			return { stream, claimedMessages };
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Handle specific Redis errors gracefully
			if (errorMessage.includes("NOGROUP")) {
				logger.warn("Consumer group does not exist for stream, skipping claim operation", {
					"aiki.stream": stream,
				});
			} else if (errorMessage.includes("BUSYGROUP")) {
				logger.warn("Consumer group busy for stream, skipping claim operation", {
					"aiki.stream": stream,
				});
			} else if (errorMessage.includes("NOSCRIPT")) {
				logger.warn("Redis script not loaded for stream, skipping claim operation", {
					"aiki.stream": stream,
				});
			} else {
				logger.error("Failed to claim messages from stream", {
					"aiki.error": errorMessage,
					"aiki.messageIds": messageIds.length,
					"aiki.workerId": workerId,
					"aiki.consumerGroup": consumerGroup,
					"aiki.stream": stream,
				});
			}
			return null;
		}
	});

	const claimResults = await Promise.allSettled(claimPromises);

	const claimedStreamEntries: unknown[] = [];
	for (const result of claimResults) {
		if (result.status === "fulfilled" && result.value !== null) {
			const { stream, claimedMessages } = result.value;
			claimedStreamEntries.push([stream, claimedMessages]);
		}
	}

	if (!isNonEmptyArray(claimedStreamEntries)) {
		return [];
	}

	return processRedisStreamMessages(redis, logger, streamConsumerGroupMap, claimedStreamEntries);
}

async function findClaimableRedisStreamMessages(
	redis: RedisClient,
	logger: Logger,
	shuffledStreams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	maxClaim: number,
	minIdleMs: number,
): Promise<ClaimableRedisStreamMessage[]> {
	const claimableMessages: ClaimableRedisStreamMessage[] = [];

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

		const pendingPromise = redis.xpending(
			stream,
			consumerGroup,
			"IDLE",
			minIdleMs,
			"-",
			"+",
			claimSize,
		).then((result) => ({ stream, result }));
		pendingPromises.push(pendingPromise);
	}

	const pendingResults = await Promise.allSettled(pendingPromises);

	for (const pendingResult of pendingResults) {
		if (pendingResult.status !== "fulfilled") {
			continue;
		}

		const { stream, result } = pendingResult.value;

		const parsedResult = RedisStreamPendingMessagesSchema.safeParse(result);
		if (!parsedResult.success) {
			logger.error("Invalid XPENDING response", {
				"aiki.stream": stream,
				"aiki.error": z.treeifyError(parsedResult.error),
			});
			continue;
		}

		for (const [messageId, consumerName, _idleTimeMs, _deliveryCount] of parsedResult.data) {
			if (consumerName === workerId) {
				continue;
			}

			claimableMessages.push({ stream, messageId });
		}
	}

	return claimableMessages;
}
