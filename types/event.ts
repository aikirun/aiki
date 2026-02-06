import type { DurationObject } from "./duration";

export type EventName = string & { _brand: "event_name" };

export const EVENT_WAIT_STATUSES = ["received", "timeout"] as const;
export type EventWaitStatus = (typeof EVENT_WAIT_STATUSES)[number];

interface EventWaitBase {
	status: EventWaitStatus;
}

export interface EventWaitReceived<Data> extends EventWaitBase {
	status: "received";
	data?: Data;
	receivedAt: number;
	reference?: EventReferenceOptions;
}

export interface EventWaitTimeout extends EventWaitBase {
	status: "timeout";
	timedOutAt: number;
}

export type EventWait<Data> = EventWaitReceived<Data> | EventWaitTimeout;

export interface EventWaitQueue<Data> {
	eventWaits: EventWait<Data>[];
}

export interface EventWaitOptions<Timed extends boolean> {
	timeout?: Timed extends true ? DurationObject : never;
}

export type EventWaitResult<Data, Timed extends boolean> = Timed extends false
	? { data: Data }
	: { timeout: false; data: Data } | { timeout: true };

export interface EventSendOptions {
	reference?: EventReferenceOptions;
}

export interface EventReferenceOptions {
	id: string;
}
