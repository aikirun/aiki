import type { NonEmptyArray } from "@aikirun/lib/collection/array";
import type {
	CreateTimerPriorityQueue,
	DueTimer,
	TimerAddResult,
	TimerEntry,
	TimerPriorityQueue,
	TimerPriorityQueueWaiter,
	TimerType,
} from "@aikirun/types/infra/timer";
import type { Redis } from "ioredis";

import { attachConnectionSupervisor, connectionTracker, untilReadyHandshake } from "../connection";

function encodeMember(type: TimerType, id: string): string {
	return `${type}:${id}`;
}

function decodeMember(member: string, rank: number): DueTimer {
	const colonIndex = member.indexOf(":");
	return {
		type: member.substring(0, colonIndex) as TimerType,
		id: member.substring(colonIndex + 1),
		rank,
	};
}

/**
 * Atomically adds entries to the sorted set and pushes a signal carrying the
 * batch's minimum rank — but only when that minimum beats the previous earliest
 * entry, or the set was empty. A signal exists to shorten the waiter's sleep;
 * a timer behind the current earliest is already covered by the wake the
 * waiter has scheduled for it. ARGV[1] is the minimum rank; subsequent pairs
 * are score/member.
 */
const ADD_AND_SIGNAL_SCRIPT = `
local head = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
for i = 2, #ARGV - 1, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
if #head == 0 or tonumber(ARGV[1]) < tonumber(head[2]) then
  redis.call('LPUSH', KEYS[2], ARGV[1])
end
return 1
`;

/**
 * Atomically pops all entries with scores <= the given max score.
 */
const POP_DUE_TIMERS_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'WITHSCORES', 'LIMIT', 0, ARGV[2])
if #due > 0 then
  local members = {}
  for i = 1, #due, 2 do
    members[#members + 1] = due[i]
  end
  redis.call('ZREM', KEYS[1], unpack(members))
end
return due
`;

/**
 * Atomically reads all signals from the list, deletes the list, and returns the
 * minimum signal value. Returns nil if the list was empty.
 */
const DRAIN_SIGNALS_SCRIPT = `
local values = redis.call('LRANGE', KEYS[1], 0, -1)
redis.call('DEL', KEYS[1])
local minSignal
for _, value in ipairs(values) do
  local n = tonumber(value)
  if not minSignal or n < minSignal then
    minSignal = n
  end
end
return minSignal
`;

export function redisTimerPriorityQueue(redis: Redis, key: string): CreateTimerPriorityQueue {
	const signalKey = `${key}:signal`;

	return ({ logger }): TimerPriorityQueue => {
		const redisTracker = connectionTracker(redis);

		return {
			async add(timers: NonEmptyArray<TimerEntry>): Promise<TimerAddResult> {
				if (!redisTracker.isAvailable()) {
					return { status: "failed" };
				}

				let minRank = timers[0].rank;
				const args: (string | number)[] = [];
				for (const timer of timers) {
					if (timer.rank < minRank) {
						minRank = timer.rank;
					}
					const member = encodeMember(timer.type, timer.id);
					args.push(timer.rank, member);
				}

				try {
					await redis.eval(ADD_AND_SIGNAL_SCRIPT, 2, key, signalKey, minRank, ...args);
				} catch (err) {
					logger.warn("Timer add command failed", { err, "aiki.count": timers.length });
					return { status: "failed" };
				}
				return { status: "added" };
			},

			async popDue({ maxRank, limit }: { maxRank: number; limit: number }): Promise<DueTimer[]> {
				redisTracker.assertIsAvailable();
				const pairs = (await redis.eval(POP_DUE_TIMERS_SCRIPT, 1, key, maxRank, limit)) as string[];
				if (pairs.length === 0) {
					return [];
				}

				const result: DueTimer[] = [];
				for (let i = 0; i + 1 < pairs.length; i += 2) {
					const member = pairs[i] as string;
					const rank = Number(pairs[i + 1]);
					result.push(decodeMember(member, rank));
				}
				return result;
			},

			async peekNext(): Promise<{ rank: number } | null> {
				redisTracker.assertIsAvailable();
				const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", 0, 1);
				if (result.length < 2) {
					return null;
				}
				return { rank: Number(result[1]) };
			},

			createWaiter(): TimerPriorityQueueWaiter {
				const redisDuplicate = redis.duplicate({
					maxRetriesPerRequest: 0,
					enableOfflineQueue: false,
				});

				let completedReadyHandshake = false;
				const connectionSupervisor = attachConnectionSupervisor(redisDuplicate, { logger });
				let closed = false;

				return {
					/**
					 * Blocks on the signal list, then drains any remaining signals.
					 * Returns the minimum signalled rank (combining BRPOP value with drained values).
					 * Returns null if BRPOP timed out — drained values are discarded in that case
					 * since peek-after-pop will rediscover them.
					 * Close tears down the connection, which surfaces here as a rejected
					 * command; a closed waiter turns that into the contract's null.
					 */
					async wait(timeoutSeconds: number): Promise<{ rank: number } | null> {
						try {
							if (!completedReadyHandshake) {
								await untilReadyHandshake(redisDuplicate);
								completedReadyHandshake = true;
							}

							const result = await redisDuplicate.brpop(signalKey, timeoutSeconds);
							if (result === null) {
								await redisDuplicate.del(signalKey);
								return null;
							}

							const signal = Number(result[1]);
							const minSignal = (await redisDuplicate.eval(DRAIN_SIGNALS_SCRIPT, 1, signalKey)) as number | null;
							if (minSignal === null) {
								return { rank: signal };
							}
							return { rank: Math.min(signal, minSignal) };
						} catch (err) {
							if (closed) {
								return null;
							}
							throw err;
						}
					},

					async close(): Promise<void> {
						if (closed) {
							return;
						}
						closed = true;
						connectionSupervisor.detach();
						redisDuplicate.disconnect();
					},
				};
			},
		};
	};
}
