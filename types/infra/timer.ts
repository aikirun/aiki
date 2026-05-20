import type { NonEmptyArray } from "@aikirun/lib/array";
import type { Logger } from "@aikirun/lib/logger";

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
	rank: number;
}

export interface DueTimer {
	type: TimerType;
	id: string;
	rank: number;
}

export interface TimerSignalWaiter {
	wait(timeoutSeconds: number): Promise<number>;
	close(): Promise<void>;
}

export interface TimerSignalWaiterContext {
	logger: Logger;
}

export interface TimerSortedSet {
	add(timers: NonEmptyArray<TimerEntry>): Promise<void>;
	popDue(maxRank: number, limit: number): Promise<DueTimer[]>;
	peekNextRank(): Promise<number | null>;
	createSignalWaiter(context: TimerSignalWaiterContext): TimerSignalWaiter;
}
