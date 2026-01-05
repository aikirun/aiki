import type { DurationObject } from "./duration";

export type EventName = string & { _brand: "event_name" };

export type EventStatus = "received" | "timeout";

interface EventStateBase {
	status: EventStatus;
}

export interface EventStateReceived<Data> extends EventStateBase {
	status: "received";
	data: Data;
	receivedAt: number;
	reference?: EventReferenceOptions;
}

export interface EventStateTimeout extends EventStateBase {
	status: "timeout";
	timedOutAt: number;
}

export type EventState<Data> = EventStateReceived<Data> | EventStateTimeout;

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
	reference?: EventReferenceOptions;
}

export interface EventReferenceOptions {
	id: string;
}
