import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Redis } from "ioredis";

const MAX_PRIORITY = 10;
const DEFAULT_PRIORITY = 0;

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

function computeScore(timestampMs: number, priority: number = DEFAULT_PRIORITY): number {
	return timestampMs * MAX_PRIORITY + priority;
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

const POP_DUE_TIMERS_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1], 'LIMIT', 0, ARGV[2])
if #due > 0 then
  redis.call('ZREM', KEYS[1], unpack(due))
end
return due
`;

export function createTimerSortedSet(redis: Redis, key: string) {
	return {
		async add(timers: NonEmptyArray<TimerEntry>): Promise<void> {
			const args: (string | number)[] = [];
			for (const timer of timers) {
				const score = computeScore(timer.dueAt, timer.priority);
				const member = encodeMember(timer.type, timer.id);
				args.push(score, member);
			}

			await redis.zadd(key, ...args);
		},

		async popDue(now: number, limit: number): Promise<DueTimer[]> {
			const maxScore = now * MAX_PRIORITY + (MAX_PRIORITY - 1);

			const members = (await redis.eval(POP_DUE_TIMERS_SCRIPT, 1, key, maxScore, limit)) as string[];
			if (members.length === 0) {
				return [];
			}

			return members.map(decodeMember);
		},
	};
}

export type TimerSortedSet = ReturnType<typeof createTimerSortedSet>;
