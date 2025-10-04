import { getRetryParams } from "@lib/retry/mod.ts";
import type { Client } from "../client.ts";
import type { Redis } from "redis";
import type { WorkflowName } from "../../workflow/workflow.ts";
import type { WorkflowRunId } from "../../workflow/run/repository.ts";
import { distributeRoundRobin, groupBy, isNonEmptyArray, shuffleArray } from "@lib/array/utils.ts";
import type { NonEmptyArray } from "@lib/array/types.ts";
import { z } from "zod";
import type { StrategyCallbacks, SubscriberDelayContext, SubscriberStrategyBuilder } from "./strategy-resolver.ts";

/**
 * Redis Streams subscriber strategy configuration
 */
export interface RedisStreamsSubscriberStrategy {
	type: "redis_streams";

	/**
	 * Polling interval in milliseconds for Redis streams
	 * @default 50
	 */
	intervalMs?: number;

	/**
	 * Maximum retry interval in milliseconds when Redis fails
	 * @default 30_000
	 */
	maxRetryIntervalMs?: number;

	/**
	 * Polling interval when at capacity (milliseconds)
	 * @default 50
	 */
	atCapacityIntervalMs?: number;

	/**
	 * How long to wait for new messages (ms)
	 * @default 1_000
	 */
	blockTimeMs?: number;

	/**
	 * Minimum idle time before claiming abandoned messages (ms)
	 * Set to 0 to disable message claiming entirely
	 * @default 60_000
	 */
	claimMinIdleTimeMs?: number;
}

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
	client: Client,
	strategy: RedisStreamsSubscriberStrategy,
	workflowNames: WorkflowName[],
	workerShards?: string[],
): SubscriberStrategyBuilder {
	const redis = client.redisStreams.getConnection();

	const streamConsumerGroupMap = getRedisStreamConsumerGroupMap(workflowNames, workerShards);
	const streams = Array.from(streamConsumerGroupMap.keys());

	const intervalMs = strategy.intervalMs ?? 50;
	const maxRetryIntervalMs = strategy.maxRetryIntervalMs ?? 30_000;
	const atCapacityIntervalMs = strategy.atCapacityIntervalMs ?? 50;
	const blockTimeMs = strategy.blockTimeMs ?? 1_000;
	const claimMinIdleTimeMs = strategy.claimMinIdleTimeMs ?? 60_000;

	const getNextDelay = (ctx: SubscriberDelayContext) => {
		switch (ctx.type) {
			case "polled":
			case "heartbeat":
				return intervalMs;
			case "retry": {
				const retryParams = getRetryParams(ctx.attemptNumber, {
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
				return ctx satisfies never;
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
						streams,
						streamConsumerGroupMap,
						workerId,
						size,
						blockTimeMs,
						claimMinIdleTimeMs,
					),
			};
		},
	};
}

function getRedisStreamConsumerGroupMap(workflowNames: WorkflowName[], shards?: string[]): Map<string, string> {

	if (!shards || !isNonEmptyArray(shards)) {
		return new Map(workflowNames.map((workflowName) => [
			`workflow:${workflowName}`,
			`worker:${workflowName}`,
		]));
	}

	return new Map(workflowNames.flatMap((workflowName) =>
		shards.map((shard) => [
			`workflow:${workflowName}:${shard}`,
			`worker:${workflowName}:${shard}`,
		])
	));
}

async function fetchRedisStreamMessages(
	redis: Redis,
	streams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	size: number,
	blockTimeMs: number,
	claimMinIdleTimeMs: number,
): Promise<WorkflowRunId[]> {
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

	const workflowRunIds = isNonEmptyArray(streamEntries)
		? await processRedisStreamMessages(redis, streamConsumerGroupMap, streamEntries)
		: [];

	const remainingCapacity = size - workflowRunIds.length;
	if (remainingCapacity > 0 && claimMinIdleTimeMs > 0) {
		const claimedWorkflowRunIds = await claimStuckRedisStreamMessages(
			redis,
			shuffledStreams,
			streamConsumerGroupMap,
			workerId,
			remainingCapacity,
			claimMinIdleTimeMs,
		);
		for (const workflowRunId of claimedWorkflowRunIds) {
			workflowRunIds.push(workflowRunId);
		}
	}

	return workflowRunIds;
}

async function processRedisStreamMessages(
	redis: Redis,
	streamConsumerGroupMap: Map<string, string>,
	streamEntries: NonEmptyArray<unknown>,
): Promise<WorkflowRunId[]> {
	const workflowRunIds: WorkflowRunId[] = [];

	for (const streamEntry of streamEntries) {
		const streamEntryResult = RedisStreamEntrySchema.safeParse(streamEntry);
		if (!streamEntryResult.success) {
			console.error("Invalid Redis stream entry structure:", streamEntryResult.error.format());
			continue;
		}

		const [stream, messages] = streamEntryResult.data;

		const consumerGroup = streamConsumerGroupMap.get(stream);
		if (!consumerGroup) {
			console.error(`No consumer group found for stream: ${stream}`);
			continue;
		}

		for (const [messageId, rawMessageData] of messages) {
			const messageData = RedisMessageDataSchema.safeParse(rawMessageData);
			if (!messageData.success) {
				console.warn(
					`Invalid message structure in ${stream}/${messageId}:`,
					messageData.error.format(),
				);
				await redis.xack(stream, consumerGroup, messageId);
				continue;
			}

			switch (messageData.data.type) {
				case "workflow_run_ready": {
					const { workflowRunId } = messageData.data.data;
					workflowRunIds.push(workflowRunId);
					break;
				}
				default:
					messageData.data.type satisfies never;
					continue;
			}

			await redis.xack(stream, consumerGroup, messageId);
		}
	}

	return workflowRunIds;
}

async function claimStuckRedisStreamMessages(
	redis: Redis,
	shuffledStreams: string[],
	streamConsumerGroupMap: Map<string, string>,
	workerId: string,
	maxClaim: number,
	minIdleMs: number,
): Promise<WorkflowRunId[]> {
	if (maxClaim <= 0 || minIdleMs <= 0) {
		return [];
	}

	const claimableMessages = await findClaimableRedisStreamMessages(
		redis,
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
				console.warn(`Consumer group does not exist for stream ${stream}, skipping claim operation`);
			} else if (errorMessage.includes("BUSYGROUP")) {
				console.warn(`Consumer group busy for stream ${stream}, skipping claim operation`);
			} else if (errorMessage.includes("NOSCRIPT")) {
				console.warn(`Redis script not loaded for stream ${stream}, skipping claim operation`);
			} else {
				// Log unexpected errors with more context
				console.error(`Failed to claim messages from stream ${stream}:`, {
					error: errorMessage,
					messageIds: messageIds.length,
					workerId,
					consumerGroup,
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

	return await processRedisStreamMessages(redis, streamConsumerGroupMap, claimedStreamEntries);
}

async function findClaimableRedisStreamMessages(
	redis: Redis,
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
			console.error(`Invalid XPENDING response for ${stream}:`, parsedResult.error.format());
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
