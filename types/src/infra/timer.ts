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
	 * Resolves with the queue front's rank when an add wakes this waiter, or with null on
	 * timeout or close. Not every add wakes a waiter: the two cases that do are listed on
	 * `TimerPriorityQueue.add`. `timeoutSeconds` of 0 waits indefinitely.
	 */
	wait(timeoutSeconds: number): Promise<{ rank: number } | null>;
	close(): Promise<void>;
}

export type TimerAddResult = { status: "added" } | { status: "failed" };

export interface TimerPriorityQueue {
	/**
	 * Adds the timers. The queue front is the timer with the lowest rank. The add wakes a
	 * waiter with the queue front's rank in two cases, and in no other:
	 * - an added timer becomes the queue front;
	 * - the queue front before the add was at or below `overdueRank`, which means no waiter
	 *   is about to wake for it.
	 */
	add(params: { timers: NonEmptyArray<TimerEntry>; overdueRank: number }): Promise<TimerAddResult>;
	popDue(params: { maxRank: number; limit: number }): Promise<DueTimer[]>;
	peekNext(): Promise<{ rank: number } | null>;
	createWaiter(): TimerPriorityQueueWaiter;
}

export interface TimerPriorityQueueContext {
	logger: Logger;
	signal?: AbortSignal;
}

export type CreateTimerPriorityQueue = (context: TimerPriorityQueueContext) => TimerPriorityQueue;
