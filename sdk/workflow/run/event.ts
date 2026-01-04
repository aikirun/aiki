import { createSerializableError, toMilliseconds } from "@aikirun/lib";
import type { ApiClient, Client, Logger } from "@aikirun/types/client";
import type { Serializable } from "@aikirun/types/error";
import type { EventId, EventSendOptions, EventState, EventWaitOptions, EventWaitState } from "@aikirun/types/event";
import { INTERNAL } from "@aikirun/types/symbols";
import {
	type WorkflowRun,
	WorkflowRunFailedError,
	type WorkflowRunId,
	WorkflowRunSuspendedError,
} from "@aikirun/types/workflow-run";

import type { WorkflowRunHandle } from "./handle";

/**
 * Defines an event type that can be sent to and waited for by workflows.
 *
 * Events are type-first with optional runtime schema validation.
 *
 * @template Data - Type of event data (must be JSON serializable)
 * @param params - Optional event configuration
 * @param opts.schema - Optional schema for runtime validation
 * @returns EventDefinition for use in workflows
 *
 * @example
 * ```typescript
 * // Type-only event (no runtime validation)
 * const approved = event<{ by: string }>();
 *
 * // Event with runtime validation
 * const rejected = event<{ by: string; reason: string }>({
 *   schema: z.object({ by: z.string(), reason: z.string() })
 * });
 * ```
 */
export function event(): EventDefinition<void>;
export function event<Data extends Serializable>(params?: EventParams<Data>): EventDefinition<Data>;
export function event<Data>(params?: EventParams<Data>): EventDefinition<Data> {
	return {
		_type: undefined as Data,
		schema: params?.schema,
	};
}

export interface EventParams<Data> {
	schema?: Schema<Data>;
}

interface EventDefinition<Data> {
	_type: Data;
	schema?: Schema<Data>;
}

export interface Schema<Data> {
	parse: (data: unknown) => Data;
}

export type EventsDefinition = Record<string, EventDefinition<unknown>>;

export type EventData<TEventDefinition> = TEventDefinition extends EventDefinition<infer Data> ? Data : never;

export type EventWaiters<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventWaiter<EventData<TEventsDefinition[K]>>;
};

export interface EventWaiter<Data> {
	wait(options?: EventWaitOptions<false>): Promise<EventWaitState<Data, false>>;
	wait(options: EventWaitOptions<true>): Promise<EventWaitState<Data, true>>;
}

export type EventSenders<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventSender<EventData<TEventsDefinition[K]>>;
};

export interface EventSender<Data> {
	send: (
		...args: Data extends void ? [data?: Data, options?: EventSendOptions] : [data: Data, options?: EventSendOptions]
	) => Promise<void>;
}

export type EventMulticasters<TEventsDefinition extends EventsDefinition> = {
	[K in keyof TEventsDefinition]: EventMulticaster<EventData<TEventsDefinition[K]>>;
};

export interface EventMulticaster<Data> {
	send: <AppContext>(
		client: Client<AppContext>,
		runId: string | string[],
		data: Data,
		options?: EventSendOptions
	) => Promise<void>;
}

export function createEventWaiters<TEventsDefinition extends EventsDefinition>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEventsDefinition>,
	eventsDefinition: TEventsDefinition,
	logger: Logger
): EventWaiters<TEventsDefinition> {
	const waiters = {} as EventWaiters<TEventsDefinition>;

	for (const [eventId, eventDefinition] of Object.entries(eventsDefinition)) {
		const waiter = createEventWaiter(
			handle,
			eventId as EventId,
			eventDefinition.schema,
			logger.child({ "aiki.eventId": eventId })
		) as EventWaiter<EventData<TEventsDefinition[keyof TEventsDefinition]>>;
		waiters[eventId as keyof TEventsDefinition] = waiter;
	}

	return waiters;
}

export function createEventWaiter<TEventsDefinition extends EventsDefinition, Data>(
	handle: WorkflowRunHandle<unknown, unknown, unknown, TEventsDefinition>,
	eventId: EventId,
	schema: Schema<Data> | undefined,
	logger: Logger
): EventWaiter<Data> {
	let nextEventIndex = 0;

	async function wait(options?: EventWaitOptions<false>): Promise<EventWaitState<Data, false>>;
	async function wait(options: EventWaitOptions<true>): Promise<EventWaitState<Data, true>>;
	async function wait(options?: EventWaitOptions<boolean>): Promise<EventWaitState<Data, boolean>> {
		await handle.refresh();

		const events = handle.run.eventsQueue[eventId]?.events ?? [];

		const event = events[nextEventIndex] as EventState<Data> | undefined;
		if (event) {
			nextEventIndex++;

			if (event.status === "timeout") {
				logger.debug("Timed out waiting for event");
				return { timeout: true };
			}

			let data: Data | undefined;
			try {
				data = schema ? schema.parse(event.data) : event.data;
			} catch (error) {
				logger.error("Invalid event data", { data: event.data, error });
				await handle[INTERNAL].transitionState({
					status: "failed",
					cause: "self",
					error: createSerializableError(error),
				});
				throw new WorkflowRunFailedError(handle.run.id as WorkflowRunId, handle.run.attempts);
			}

			logger.debug("Event received");
			return { timeout: false, data };
		}

		const timeoutInMs = options?.timeout && toMilliseconds(options.timeout);
		logger.info("Waiting for event", {
			...(timeoutInMs !== undefined ? { "aiki.timeoutInMs": timeoutInMs } : {}),
		});

		await handle[INTERNAL].transitionState({
			status: "awaiting_event",
			eventId,
			timeoutInMs,
		});

		throw new WorkflowRunSuspendedError(handle.run.id as WorkflowRunId);
	}

	return { wait };
}

export function createEventSenders<TEventsDefinition extends EventsDefinition>(
	api: ApiClient,
	workflowRunId: string,
	eventsDefinition: TEventsDefinition,
	logger: Logger,
	onSend: (run: WorkflowRun<unknown, unknown>) => void
): EventSenders<TEventsDefinition> {
	const senders = {} as EventSenders<TEventsDefinition>;

	for (const [eventId, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventSender(
			api,
			workflowRunId,
			eventId as EventId,
			eventDefinition.schema,
			logger.child({ "aiki.eventId": eventId }),
			onSend
		) as EventSender<EventData<TEventsDefinition[keyof TEventsDefinition]>>;
		senders[eventId as keyof TEventsDefinition] = sender;
	}

	return senders;
}

function createEventSender<Data>(
	api: ApiClient,
	workflowRunId: string,
	eventId: EventId,
	schema: Schema<Data> | undefined,
	logger: Logger,
	onSend: (run: WorkflowRun<unknown, unknown>) => void
): EventSender<Data> {
	return {
		async send(
			...args: Data extends void ? [data?: Data, options?: EventSendOptions] : [data: Data, options?: EventSendOptions]
		): Promise<void> {
			const [data, options] = args;

			if (schema) {
				schema.parse(data);
			}

			logger.debug("Sending event", {
				...(options?.idempotencyKey ? { "aiki.idempotencyKey": options.idempotencyKey } : {}),
			});

			const { run } = await api.workflowRun.sendEventV1({
				id: workflowRunId,
				eventId,
				data,
				options,
			});
			onSend(run);
		},
	};
}

export function createEventMulticasters<TEventsDefinition extends EventsDefinition>(
	eventsDefinition: TEventsDefinition
): EventMulticasters<TEventsDefinition> {
	const senders = {} as EventMulticasters<TEventsDefinition>;

	for (const [eventId, eventDefinition] of Object.entries(eventsDefinition)) {
		const sender = createEventMulticaster(eventId as EventId, eventDefinition.schema) as EventMulticaster<
			EventData<TEventsDefinition[keyof TEventsDefinition]>
		>;
		senders[eventId as keyof TEventsDefinition] = sender;
	}

	return senders;
}

function createEventMulticaster<Data>(eventId: EventId, schema: Schema<Data> | undefined): EventMulticaster<Data> {
	return {
		async send<AppContext>(
			client: Client<AppContext>,
			runId: string | string[],
			data: Data,
			options?: EventSendOptions
		): Promise<void> {
			if (schema) {
				schema.parse(data);
			}

			const runIds = Array.isArray(runId) ? runId : [runId];

			await client.api.workflowRun.multicastEventV1({
				ids: runIds,
				eventId,
				data,
				options,
			});
		},
	};
}
