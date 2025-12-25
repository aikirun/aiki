import type { DurationObject } from "./duration";

export type EventId = string & { _brand: "event_id" };

export type EventStatus = "received" | "timeout";

interface EventStateBase {
	status: EventStatus;
}

export interface EventStateReceived<Data> extends EventStateBase {
	status: "received";
	data: Data;
	receivedAt: number;
	idempotencyKey?: string;
}

export interface EventStateTimedOut extends EventStateBase {
	status: "timeout";
	timedOutAt: number;
}

export type EventState<Data> = EventStateReceived<Data> | EventStateTimedOut;

export interface EventQueue<Data> {
	events: EventState<Data>[];
}

export interface EventWaitOptions<Timed extends boolean> {
	timeout?: Timed extends true ? DurationObject : never;
}

export type EventWaitState<Data, Timed extends boolean> = Timed extends false
	? { data: Data }
	: { timeout: false; data: Data } | { timeout: true };

export interface EventSendOptions {
	idempotencyKey?: string;
}
