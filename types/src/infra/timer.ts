import type { NonEmptyArray } from "@aikirun/lib/collection/array";
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
	rank: number;
}

export interface DueTimer {
	type: TimerType;
	id: string;
	rank: number;
}

export interface TimerPriorityQueueWaiter {
	/**
	 * Resolves when a new timer whose rank is lower than the
	 * queue front's rank arrives, or null on timeout or close.
	 * `timeoutSeconds` of 0 waits indefinitely.
	 */
	wait(timeoutSeconds: number): Promise<{ rank: number } | null>;
	close(): Promise<void>;
}

export type TimerAddResult = { status: "added" } | { status: "failed" };

export interface TimerPriorityQueue {
	add(timers: NonEmptyArray<TimerEntry>): Promise<TimerAddResult>;
	popDue(params: { maxRank: number; limit: number }): Promise<DueTimer[]>;
	peekNext(): Promise<{ rank: number } | null>;
	createWaiter(): TimerPriorityQueueWaiter;
}

export interface TimerPriorityQueueContext {
	logger: Logger;
	signal: AbortSignal;
}

export type CreateTimerPriorityQueue = (context: TimerPriorityQueueContext) => TimerPriorityQueue;
