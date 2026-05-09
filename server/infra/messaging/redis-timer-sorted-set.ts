import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Redis } from "ioredis";

const PRIORITY_LEVELS = 10;
const DEFAULT_PRIORITY = PRIORITY_LEVELS - 1;

export type TimerType =
	| "scheduled"
	| "sleep"
	| "retry"
	| "task_retry"
	| "event_wait_timeout"
	| "child_wait_timeout"
	| "recurring";

export interface TimerEntry {
	type: TimerType;
	id: string;
	dueAt: number;
	priority?: number;
}

export interface DueTimer {
	type: TimerType;
	id: string;
}

export interface TimerSignalWaiter {
	wait(timeoutSeconds: number): Promise<number>;
	close(): Promise<void>;
}

function computeScore(timestampMs: number, priority: number = DEFAULT_PRIORITY): number {
	return timestampMs * PRIORITY_LEVELS + priority;
}

function encodeMember(type: TimerType, id: string): string {
	return `${type}:${id}`;
}

function decodeMember(member: string): DueTimer {
	const colonIndex = member.indexOf(":");
	return {
		type: member.substring(0, colonIndex) as TimerType,
		id: member.substring(colonIndex + 1),
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
local due = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
if #due > 0 then
  redis.call('ZREM', KEYS[1], unpack(due))
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

export function createTimerSortedSet(redis: Redis, key: string) {
	const signalKey = `${key}:signal`;

	return {
		async add(timers: NonEmptyArray<TimerEntry>): Promise<void> {
			let minDueAt = timers[0].dueAt;
			const args: (string | number)[] = [];
			for (const timer of timers) {
				if (timer.dueAt < minDueAt) {
					minDueAt = timer.dueAt;
				}
				const score = computeScore(timer.dueAt, timer.priority);
				const member = encodeMember(timer.type, timer.id);
				args.push(score, member);
			}

			await redis.eval(ADD_AND_SIGNAL_SCRIPT, 2, key, signalKey, minDueAt, ...args);
		},

		async popDue(before: number, limit: number): Promise<DueTimer[]> {
			const maxScore = before * PRIORITY_LEVELS + (PRIORITY_LEVELS - 1);

			const members = (await redis.eval(POP_DUE_TIMERS_SCRIPT, 1, key, maxScore, limit)) as string[];
			if (members.length === 0) {
				return [];
			}

			return members.map(decodeMember);
		},

		async peek(): Promise<number | null> {
			const result = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES", "LIMIT", 0, 1);
			if (result.length < 2) {
				return null;
			}
			const score = Number(result[1]);
			return Math.floor(score / PRIORITY_LEVELS);
		},

		createSignalWaiter(): TimerSignalWaiter {
			const redisDuplicate = redis.duplicate();
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
					redisDuplicate.disconnect();
				},
			};
		},
	};
}

export type TimerSortedSet = ReturnType<typeof createTimerSortedSet>;
