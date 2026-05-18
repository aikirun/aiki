import type { NonEmptyArray } from "@aikirun/types/array";
import type {
	DueTimer,
	TimerEntry,
	TimerSignalWaiter,
	TimerSignalWaiterContext,
	TimerSortedSet,
	TimerType,
} from "@aikirun/types/timer";
import type { Redis } from "ioredis";

import { attachConnectionSupervisor } from "../connection";

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
 * minimum dueAt timestamp of the batch. ARGV[1] is the minDueAt; subsequent
 * pairs are score/member.
 */
const ADD_AND_SIGNAL_SCRIPT = `
local minDueAt = ARGV[1]
for i = 2, #ARGV - 1, 2 do
  redis.call('ZADD', KEYS[1], ARGV[i], ARGV[i + 1])
end
redis.call('LPUSH', KEYS[2], minDueAt)
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

export function redisTimerSortedSet(redis: Redis, key: string): TimerSortedSet {
	const signalKey = `${key}:signal`;

	return {
		async add(timers: NonEmptyArray<TimerEntry>): Promise<void> {
			let minDueAt = timers[0].dueAt;
			const args: (string | number)[] = [];
			for (const timer of timers) {
				if (timer.dueAt < minDueAt) {
					minDueAt = timer.dueAt;
				}
				const member = encodeMember(timer.type, timer.id);
				args.push(timer.rank, member);
			}

			await redis.eval(ADD_AND_SIGNAL_SCRIPT, 2, key, signalKey, minDueAt, ...args);
		},

		async popDue(maxRank: number, limit: number): Promise<DueTimer[]> {
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

		async peekNextRank(): Promise<number | null> {
			const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", 0, 1);
			if (result.length < 2) {
				return null;
			}
			return Number(result[1]);
		},

		createSignalWaiter(context: TimerSignalWaiterContext): TimerSignalWaiter {
			const redisDuplicate = redis.duplicate({
				maxRetriesPerRequest: 0,
				enableOfflineQueue: false,
			});
			const connectionSupervisor = attachConnectionSupervisor(redisDuplicate, {
				connectTimeoutMs: redis.options.connectTimeout,
				logger: context.logger,
			});
			let closed = false;

			return {
				/**
				 * Blocks on the signal list, then drains any remaining signals.
				 * Returns the minimum signal observed (combining BRPOP value with drained values).
				 * Returns 0 if BRPOP timed out — drained values are discarded in that case since
				 * peek-after-pop will rediscover them.
				 */
				async wait(timeoutSeconds: number): Promise<number> {
					const result = await redisDuplicate.brpop(signalKey, timeoutSeconds);
					if (result === null) {
						await redis.del(signalKey);
						return 0;
					}

					const signal = Number(result[1]);
					const minSignal = (await redis.eval(DRAIN_SIGNALS_SCRIPT, 1, signalKey)) as number | null;
					if (minSignal === null) {
						return signal;
					}
					return Math.min(signal, minSignal);
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
}
