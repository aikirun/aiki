import type { DurationObject } from "./duration";

export type EventName = string & { _brand: "event_name" };

export const EVENT_WAIT_STATUSES = ["received", "timeout"] as const;
export type EventWaitStatus = (typeof EVENT_WAIT_STATUSES)[number];

interface EventWaitStateBase {
	status: EventWaitStatus;
}

export interface EventWaitStateReceived<Data> extends EventWaitStateBase {
	status: "received";
	data?: Data;
	receivedAt: number;
	reference?: EventReferenceOptions;
}

export interface EventWaitStateTimeout extends EventWaitStateBase {
	status: "timeout";
	timedOutAt: number;
}

export type EventWaitState<Data> = EventWaitStateReceived<Data> | EventWaitStateTimeout;

export interface EventWaitQueue<Data> {
	eventWaits: EventWaitState<Data>[];
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
